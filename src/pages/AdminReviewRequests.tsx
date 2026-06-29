import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Star, Send, Search, Loader2 } from "lucide-react";

type Soum = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  desired_install_date: string | null;
  created_at: string;
  status: string;
};

const DEFAULT_TPL = `Bonjour {{prenom}}, merci d'avoir fait confiance à Toitures VB pour vos travaux de {{mois_année}}. Si vous êtes satisfait, votre avis Google nous aiderait beaucoup : {{lien}} Répondez STOP pour vous désabonner.`;

export default function AdminReviewRequests() {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clients, setClients] = useState<Soum[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [campaignName, setCampaignName] = useState("Demande d'avis Google");
  const [reviewUrl, setReviewUrl] = useState("https://g.page/r/YOUR_GOOGLE_REVIEW_ID/review");
  const [template, setTemplate] = useState(DEFAULT_TPL);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [optouts, setOptouts] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    const sb = supabase as any;
    const [{ data: soums }, { data: cps }, { data: opts }] = await Promise.all([
      sb.from("soumissions")
        .select("id,first_name,last_name,phone,desired_install_date,created_at,status")
        .not("phone", "is", null)
        .order("created_at", { ascending: false })
        .limit(500),
      sb.from("review_campaigns").select("*").order("created_at", { ascending: false }).limit(20),
      sb.from("review_optouts").select("phone"),
    ]);
    setClients((soums as Soum[]) || []);
    setCampaigns(cps || []);
    setOptouts(new Set((opts || []).map((o: any) => o.phone)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.first_name, c.last_name, c.phone].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [clients, search]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  };

  const preview = useMemo(() => {
    const sample = clients.find((c) => selected.has(c.id)) || clients[0];
    if (!sample) return template;
    const d = sample.desired_install_date || sample.created_at;
    const ma = d ? new Date(d).toLocaleDateString("fr-CA", { month: "long", year: "numeric" }) : "";
    return template
      .replace(/\{\{\s*prenom\s*\}\}/g, sample.first_name || "")
      .replace(/\{\{\s*nom\s*\}\}/g, sample.last_name || "")
      .replace(/\{\{\s*mois_ann[ée]e\s*\}\}/g, ma)
      .replace(/\{\{\s*lien\s*\}\}/g, reviewUrl);
  }, [template, selected, clients, reviewUrl]);

  const send = async () => {
    if (selected.size === 0) return toast.error("Sélectionnez au moins un client");
    if (!reviewUrl.trim()) return toast.error("Lien Google Reviews requis");
    setSending(true);
    try {
      const { data: campaign, error } = await (supabase as any).from("review_campaigns").insert({
        name: campaignName,
        template_body: template,
        google_review_url: reviewUrl,
        total_recipients: selected.size,
      }).select().single();
      if (error) throw error;

      const recipients = clients.filter((c) => selected.has(c.id)).map((c) => ({
        soumission_id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        service_date: c.desired_install_date || c.created_at,
      }));

      const { data, error: fnErr } = await supabase.functions.invoke("review-send-batch", {
        body: { campaignId: campaign.id, recipients },
      });
      if (fnErr) throw fnErr;
      toast.success(`Envoyé : ${data.sent}/${data.total} (${data.failed} échecs)`);
      setSelected(new Set());
      load();
    } catch (e: any) {
      toast.error(e.message || "Erreur d'envoi");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 text-zinc-200">
      <div className="flex items-center gap-3">
        <Star className="h-6 w-6 text-yellow-400" />
        <h1 className="text-xl md:text-2xl font-semibold">Demandes d'avis Google</h1>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4 bg-[hsl(230,22%,10%)] border-[hsl(230,20%,15%)] space-y-3">
          <div>
            <Label>Nom de la campagne</Label>
            <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="bg-[hsl(230,22%,7%)] border-[hsl(230,20%,15%)]" />
          </div>
          <div>
            <Label>Lien Google Reviews</Label>
            <Input value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/r/.../review" className="bg-[hsl(230,22%,7%)] border-[hsl(230,20%,15%)]" />
          </div>
          <div>
            <Label>Modèle SMS</Label>
            <Textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={5} className="bg-[hsl(230,22%,7%)] border-[hsl(230,20%,15%)]" />
            <p className="text-[11px] text-zinc-500 mt-1">Variables : {`{{prenom}}, {{nom}}, {{mois_année}}, {{lien}}`}</p>
          </div>
          <div>
            <Label>Aperçu</Label>
            <div className="text-sm p-3 rounded bg-[hsl(230,22%,7%)] border border-[hsl(230,20%,15%)] whitespace-pre-wrap">{preview}</div>
          </div>
          <Button onClick={send} disabled={sending || selected.size === 0} className="w-full">
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Envoyer à {selected.size} destinataire{selected.size > 1 ? "s" : ""}
          </Button>
        </Card>

        <Card className="p-4 bg-[hsl(230,22%,10%)] border-[hsl(230,20%,15%)] space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-zinc-500" />
            <Input placeholder="Rechercher un client…" value={search} onChange={(e) => setSearch(e.target.value)} className="bg-[hsl(230,22%,7%)] border-[hsl(230,20%,15%)]" />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <button onClick={toggleAll} className="underline">
              {selected.size === filtered.length && filtered.length > 0 ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
            <span>{selected.size} / {filtered.length}</span>
          </div>
          <div className="max-h-[420px] overflow-auto divide-y divide-[hsl(230,20%,15%)]">
            {loading && <div className="text-sm text-zinc-500 p-3">Chargement…</div>}
            {!loading && filtered.map((c) => {
              const optedOut = c.phone && optouts.has(c.phone.startsWith("+") ? c.phone : `+1${c.phone.replace(/\D/g, "")}`);
              return (
                <label key={c.id} className="flex items-center gap-3 py-2 cursor-pointer hover:bg-[hsl(230,22%,8%)] px-2 rounded">
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} disabled={!!optedOut} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{c.first_name} {c.last_name}</div>
                    <div className="text-[11px] text-zinc-500 truncate">{c.phone}</div>
                  </div>
                  {optedOut && <Badge variant="outline" className="text-[10px]">STOP</Badge>}
                </label>
              );
            })}
            {!loading && filtered.length === 0 && <div className="text-sm text-zinc-500 p-3">Aucun client.</div>}
          </div>
        </Card>
      </div>

      <Card className="p-4 bg-[hsl(230,22%,10%)] border-[hsl(230,20%,15%)]">
        <h2 className="text-sm font-semibold mb-3">Historique des campagnes</h2>
        <div className="space-y-2">
          {campaigns.length === 0 && <div className="text-sm text-zinc-500">Aucune campagne envoyée.</div>}
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm border border-[hsl(230,20%,15%)] rounded p-2">
              <div>
                <div>{c.name}</div>
                <div className="text-[11px] text-zinc-500">{new Date(c.created_at).toLocaleString("fr-CA")}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">{c.status}</Badge>
                <span className="text-emerald-400">{c.sent_count} envoyés</span>
                {c.failed_count > 0 && <span className="text-red-400">{c.failed_count} échecs</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}