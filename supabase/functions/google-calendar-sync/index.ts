import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { cors, runAdminGuards } from "../_shared/hardening.ts";

const GCAL_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const reqHeaders = req.headers.get("access-control-request-headers");
  const corsHeaders = cors(origin, reqHeaders);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const guardResp = await runAdminGuards(req, corsHeaders);
  if (guardResp) return guardResp;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Get tokens
    const { data: tokenRow } = await supabase
      .from("google_calendar_tokens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "Google Calendar not connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auto-refresh if expired
    let accessToken = tokenRow.access_token;
    if (new Date(tokenRow.expires_at) < new Date()) {
      const refreshResp = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: tokenRow.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const refreshData = await refreshResp.json();
      if (!refreshResp.ok) {
        return new Response(JSON.stringify({ error: "Token refresh failed", details: refreshData }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = refreshData.access_token;
      await supabase.from("google_calendar_tokens").update({
        access_token: accessToken,
        expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", tokenRow.id);
    }

    const body = await req.json();
    const { action, appointment } = body;
    const calendarId = tokenRow.calendar_id || "primary";

    // ── PULL EVENTS (Google → Supabase) ──
    if (action === "pull") {
      const timeMin = body.timeMin || new Date(Date.now() - 90 * 86400000).toISOString();
      const timeMax = body.timeMax || new Date(Date.now() + 180 * 86400000).toISOString();

      const listUrl = `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=250`;
      const gcalResp = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const gcalData = await gcalResp.json();
      if (!gcalResp.ok) {
        return new Response(JSON.stringify({ error: "Failed to list events", details: gcalData }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const events = gcalData.items || [];
      let imported = 0;

      for (const ev of events) {
        if (!ev.id || ev.status === "cancelled") continue;
        const startDt = ev.start?.dateTime || ev.start?.date;
        if (!startDt) continue;

        const endDt = ev.end?.dateTime || ev.end?.date;
        const durationMs = endDt && startDt ? new Date(endDt).getTime() - new Date(startDt).getTime() : 3600000;
        const durationMin = Math.round(durationMs / 60000) || 60;

        // Parse name from summary – handles multiple formats:
        // "Visite – First Last", "30 min with Toitures (First Last)", "First Last"
        let firstName = ev.summary || "Événement";
        let lastName = "";
        const summary = (ev.summary || "").trim();
        
        // 1) Try "(First Last)" pattern from Google Appointment Schedule
        const parenMatch = summary.match(/\(([^)]+)\)\s*$/);
        // 2) Try "Visite – First Last"
        const visitMatch = summary.match(/^Visite\s*[–-]\s*(.+)/i);
        // 3) Try extracting from notes: "Réservé par First Last email@..."
        const notesBookedMatch = (ev.description || "").match(/R[ée]serv[ée]\s*par\s*(?:<[^>]*>)?\s*([A-ZÀ-Ü][a-zà-ÿ]+(?:\s+[A-ZÀ-Ü][a-zà-ÿ]+)+)/i);
        
        let nameStr = "";
        if (parenMatch) {
          nameStr = parenMatch[1].trim();
        } else if (visitMatch) {
          nameStr = visitMatch[1].trim();
        } else if (notesBookedMatch) {
          nameStr = notesBookedMatch[1].trim();
        } else {
          nameStr = summary;
        }
        
        // Split into first/last if it looks like a person name (2+ words)
        const nameParts = nameStr.split(/\s+/).filter(Boolean);
        if (nameParts.length >= 2 && !/[|@#]/.test(nameStr)) {
          firstName = nameParts[0];
          lastName = nameParts.slice(1).join(" ");
        } else {
          firstName = nameStr;
          lastName = "";
        }

        // Parse phone/email from description
        let phone = null;
        let email = null;
        let address = ev.location || null;
        if (ev.description) {
          const phoneMatch = ev.description.match(/T[ée]l\s*:\s*(.+)/i);
          if (phoneMatch) phone = phoneMatch[1].trim();
          const emailMatch = ev.description.match(/Courriel\s*:\s*(.+)/i);
          if (emailMatch) email = emailMatch[1].trim();
        }

        // Check attendees for email
        if (!email && ev.attendees?.length) {
          const attendee = ev.attendees.find((a: any) => !a.self);
          if (attendee?.email) email = attendee.email;
        }

        // Upsert by google_event_id
        const { data: existing } = await supabase
          .from("appointments")
          .select("id")
          .eq("google_event_id", ev.id)
          .maybeSingle();

        if (existing) {
          await supabase.from("appointments").update({
            scheduled_at: new Date(startDt).toISOString(),
            duration_minutes: durationMin,
            client_first_name: firstName,
            client_last_name: lastName,
            client_phone: phone,
            client_email: email,
            formatted_address: address,
            notes: ev.description || null,
            updated_at: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          await supabase.from("appointments").insert({
            google_event_id: ev.id,
            scheduled_at: new Date(startDt).toISOString(),
            duration_minutes: durationMin,
            client_first_name: firstName,
            client_last_name: lastName,
            client_phone: phone,
            client_email: email,
            formatted_address: address,
            notes: ev.description || null,
            status: "confirmed",
          });
          imported++;
        }
      }

      return new Response(JSON.stringify({ success: true, total: events.length, imported }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CREATE EVENT ──
    if (action === "create") {
      const startTime = new Date(appointment.scheduled_at);
      const endTime = new Date(startTime.getTime() + (appointment.duration_minutes || 60) * 60000);

      const event = {
        summary: `Visite – ${appointment.client_first_name} ${appointment.client_last_name}`,
        description: [
          appointment.client_phone ? `Tél: ${appointment.client_phone}` : "",
          appointment.client_email ? `Courriel: ${appointment.client_email}` : "",
          appointment.notes || "",
        ].filter(Boolean).join("\n"),
        location: appointment.formatted_address || "",
        start: { dateTime: startTime.toISOString(), timeZone: "America/Toronto" },
        end: { dateTime: endTime.toISOString(), timeZone: "America/Toronto" },
      };

      const gcalResp = await fetch(`${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });

      const gcalData = await gcalResp.json();
      if (!gcalResp.ok) {
        console.error("Google Calendar create failed:", gcalData);
        return new Response(JSON.stringify({ error: "Failed to create event", details: gcalData }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update appointment with google_event_id
      if (appointment.id) {
        await supabase.from("appointments").update({
          google_event_id: gcalData.id,
        }).eq("id", appointment.id);
      }

      return new Response(JSON.stringify({ success: true, google_event_id: gcalData.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── UPDATE EVENT ──
    if (action === "update" && appointment.google_event_id) {
      const startTime = new Date(appointment.scheduled_at);
      const endTime = new Date(startTime.getTime() + (appointment.duration_minutes || 60) * 60000);

      const event = {
        summary: `Visite – ${appointment.client_first_name} ${appointment.client_last_name}`,
        description: [
          appointment.client_phone ? `Tél: ${appointment.client_phone}` : "",
          appointment.client_email ? `Courriel: ${appointment.client_email}` : "",
          appointment.notes || "",
        ].filter(Boolean).join("\n"),
        location: appointment.formatted_address || "",
        start: { dateTime: startTime.toISOString(), timeZone: "America/Toronto" },
        end: { dateTime: endTime.toISOString(), timeZone: "America/Toronto" },
      };

      const gcalResp = await fetch(
        `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${appointment.google_event_id}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(event),
        }
      );

      if (!gcalResp.ok) {
        const err = await gcalResp.json();
        return new Response(JSON.stringify({ error: "Failed to update event", details: err }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DELETE EVENT ──
    if (action === "delete" && appointment.google_event_id) {
      await fetch(
        `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${appointment.google_event_id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action or missing google_event_id" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("google-calendar-sync error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
