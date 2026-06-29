import React, { useEffect, useRef, useState } from 'react';
import PullToRefresh from '@/components/PullToRefresh';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import vbLogo from '@/assets/vb-logo-white.svg';
import { NavLink } from '@/components/NavLink';
import CopilotChat from '@/components/admin/CopilotChat';
import {
  SidebarProvider,
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { FileText, PlusCircle, LogOut, Package, UserPlus, Shield, ClipboardList, Truck, CloudSun, FlaskConical, Boxes, Bot, ListChecks, Calculator, HardHat, Layers, Brain, Sun, Briefcase, Clock, Wrench, GraduationCap, ChevronDown, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

type NavIcon = React.ComponentType<{ className?: string }>;
interface NavItem { title: string; url: string; icon: NavIcon; subItem?: boolean }
interface NavGroup { id: string; label: string; icon: NavIcon; items: NavItem[] }

// Diagnostic (/admin/diagnostics) is intentionally dropped from the sidebar —
// the route stays registered in App.tsx, it's just not surfaced here.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'soumissions', label: 'Soumissions & Projets', icon: Briefcase,
    items: [
      { title: 'Projet, soumission et Leads', url: '/admin', icon: FileText },
      { title: 'Nouvelle soumission', url: '/admin/quote', icon: PlusCircle },
      { title: 'Suivi projet', url: '/admin/projects', icon: ClipboardList },
      { title: 'Tâches', url: '/admin/tasks', icon: ListChecks },
      { title: 'Timesheets', url: '/admin/timesheets', icon: Clock },
    ],
  },
  {
    id: 'operations', label: 'Opérations', icon: Truck,
    items: [
      { title: 'Appels', url: '/admin/call', icon: Phone },
      { title: 'Dispatch', url: '/admin/dispatch', icon: Truck },
      { title: 'Carte radar', url: '/admin/radar', icon: CloudSun },
      { title: 'Contacts', url: '/admin/contacts', icon: UserPlus },
      { title: 'Embauche couvreurs', url: '/admin/embauche', icon: HardHat },
    ],
  },
  {
    id: 'outils', label: 'Outils', icon: Wrench,
    items: [
      { title: 'Traceur 3D', url: '/admin/roof-studio', icon: Boxes },
      { title: 'Solar 3D viewer', url: '/admin/solar-3d', icon: Sun },
      { title: 'Marie-Ève (IA)', url: '/admin/marieve', icon: Bot },
      { title: 'Calculateur Ifinance', url: '/admin/financing', icon: Calculator },
    ],
  },
  {
    id: 'catalogue', label: 'Catalogue & Training', icon: GraduationCap,
    items: [
      { title: 'Liste de produits', url: '/admin/products', icon: Package },
      { title: 'Garanties', url: '/admin/warranties', icon: Shield },
      { title: 'Training Lab', url: '/admin/training-lab', icon: FlaskConical },
      { title: 'Batchs', url: '/admin/training-lab/batches', icon: Layers, subItem: true },
      { title: 'Modèles', url: '/admin/training-lab/models', icon: Brain, subItem: true },
    ],
  },
];

const SIDEBAR_GROUPS_KEY = 'admin_sidebar_groups_v1';

function loadGroupState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDEBAR_GROUPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { soumissions: true, operations: false, outils: false, catalogue: false };
}

function activeGroupId(pathname: string): string | undefined {
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (pathname === it.url || pathname.startsWith(`${it.url}/`)) return g.id;
    }
  }
  return undefined;
}

function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const navigate = useNavigate();
  const location = useLocation();

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadGroupState);

  // Auto-open the group owning the active route (mount + on navigation).
  useEffect(() => {
    const gid = activeGroupId(location.pathname);
    if (gid) setOpenGroups((prev) => (prev[gid] ? prev : { ...prev, [gid]: true }));
  }, [location.pathname]);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(openGroups)); } catch { /* ignore */ }
  }, [openGroups]);

  const toggleGroup = (id: string) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/admin/login');
  };

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton asChild>
        <NavLink
          to={item.url}
          end
          className={`hover:bg-[hsl(230,20%,14%)] text-[hsl(230,10%,60%)] rounded-lg ${item.subItem ? 'pl-9 pr-3' : 'px-3'} py-2.5 md:py-2 text-base md:text-sm flex items-center gap-2`}
          activeClassName="bg-[hsl(230,20%,16%)] text-[hsl(250,80%,75%)] font-semibold"
        >
          <item.icon className="mr-2 h-5 w-5 md:h-4 md:w-4 shrink-0" />
          {!collapsed && <span>{item.title}</span>}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-[hsl(230,20%,15%)] bg-[hsl(230,22%,8%)]">
      <SidebarContent className="bg-[hsl(230,22%,8%)]">
        <div className="px-4 py-4 flex items-center gap-3">
          <img src={vbLogo} alt="Toitures VB" className="h-8 w-auto shrink-0" style={{ filter: 'brightness(0) invert(1)' }} />
          {!collapsed && (
            <div>
              <div className="text-xs md:text-[10px] text-[hsl(230,10%,45%)]">Administration</div>
            </div>
          )}
        </div>

        {collapsed ? (
          // Icon-only mode: flatten every item, no group headers.
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_GROUPS.flatMap((g) => g.items).map(renderItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          NAV_GROUPS.map((group) => {
            const isOpen = !!openGroups[group.id];
            return (
              <SidebarGroup key={group.id} className="py-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[hsl(230,10%,45%)] hover:text-[hsl(230,10%,72%)] text-xs md:text-[11px] uppercase tracking-wider"
                  aria-expanded={isOpen}
                >
                  <group.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                </button>
                {isOpen && (
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map(renderItem)}
                    </SidebarMenu>
                  </SidebarGroupContent>
                )}
              </SidebarGroup>
            );
          })
        )}

        <div className="mt-auto px-3 pb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="w-full justify-start text-[hsl(230,10%,45%)] hover:text-white hover:bg-[hsl(230,20%,14%)] text-sm md:text-xs gap-2 py-2.5 md:py-2"
          >
            <LogOut size={14} />
            {!collapsed && 'Déconnexion'}
          </Button>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const hideCopilot = location.pathname.startsWith('/admin/solar-3d') || (isMobile && (
    location.pathname === '/admin/radar' ||
    location.pathname.startsWith('/admin/quote') ||
    location.pathname === '/admin' ||
    location.pathname === '/admin/'
  ));
  // Full-bleed routes own their internal scroll architecture (Gantt, Dispatch,
  // Radar). They must NOT be wrapped in PullToRefresh — that wrapper installs
  // its own scroll container + a translateY transform, which fights with their
  // sticky headers, sync'd scroll panes and fixed-position dropdowns.
  const isFullBleed =
    location.pathname.startsWith('/admin/projects') ||
    location.pathname.startsWith('/admin/dispatch') ||
    location.pathname.startsWith('/admin/radar') ||
    location.pathname.startsWith('/admin/roof-studio') ||
    // Training Lab opens the AdminRoofStudio tracer as a position:fixed inset:0
    // overlay. PullToRefresh's translateY transform turns into a containing block
    // for position:fixed, so the overlay stops at the header instead of covering
    // the viewport, clipping the studio toolbar.
    location.pathname.startsWith('/admin/training-lab');
  // Training Lab : on garde isFullBleed (pas de PullToRefresh wrapper, pour que
  // l'overlay du tracer en position:fixed ne soit pas clippé par un transform
  // parent), MAIS on AUTORISE le scroll sur le main parce que la liste des
  // datasets dépasse forcément le viewport. Sans ça, l'utilisateur ne peut
  // pas atteindre les datasets sous le pli.
  const allowScrollInFullBleed = location.pathname.startsWith('/admin/training-lab');
  // One-time intro: shine sweep across the logo + whoosh sfx
  const [logoIntro, setLogoIntro] = useState(false);
  const introPlayedRef = useRef(false);
  useEffect(() => {
    if (introPlayedRef.current) return;
    if (sessionStorage.getItem('admin_logo_intro_played')) return;
    introPlayedRef.current = true;
    const t = setTimeout(() => {
      setLogoIntro(true);
      sessionStorage.setItem('admin_logo_intro_played', '1');
      // (Whoosh sound is played by SplashScreen at app open; header keeps the visual shine only)
      // Clear the highlight class after the animation finishes
      setTimeout(() => setLogoIntro(false), 1600);
    }, 250);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate('/admin/login');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (!session) navigate('/admin/login');
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen={!isMobile}>
      <div
        className="admin-shell dark flex w-full overflow-hidden"
        style={{ background: '#0a0a14', color: '#e5e7eb', height: '100dvh' }}
      >
        <AdminSidebar />
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <header
            className="flex items-center border-b border-[hsl(230,20%,12%)] bg-[hsl(230,22%,7%)] z-50 px-2 shrink-0"
            style={{
              paddingTop: 'env(safe-area-inset-top)',
              paddingLeft: 'max(8px, env(safe-area-inset-left))',
              paddingRight: 'max(8px, env(safe-area-inset-right))',
              minHeight: 'calc(44px + env(safe-area-inset-top))',
            }}
          >
            <SidebarTrigger className="text-[hsl(230,10%,45%)] hover:text-white" />
            {isMobile && (
              <span
                className={`relative ml-3 inline-block overflow-hidden ${logoIntro ? 'logo-shine' : ''}`}
                style={{ lineHeight: 0 }}
              >
                <img src={vbLogo} alt="Toitures VB" className="h-5 w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
              </span>
            )}
          </header>
          {isMobile && !isFullBleed ? (
            <PullToRefresh>
              <Outlet />
            </PullToRefresh>
          ) : (
            <main
              className={
                isFullBleed
                  ? (allowScrollInFullBleed ? 'flex-1 min-h-0 overflow-y-auto' : 'flex-1 min-h-0 overflow-hidden')
                  : 'flex-1 min-h-0 overflow-auto'
              }
              style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
            >
              <Outlet />
            </main>
          )}
        </div>
        {!hideCopilot && <CopilotChat />}
      </div>
    </SidebarProvider>
  );
};

export default AdminLayout;
