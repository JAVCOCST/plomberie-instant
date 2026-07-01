import {
  Briefcase,
  FileText,
  PlusCircle,
  Clock,
  Truck,
  Users,
  UserPlus,
  HardHat,
  Wrench,
  Calculator,
  Bot,
  Package,
  Shield,
  Boxes,
  ClipboardCheck,
  Plug,
  CheckCircle2,
} from "lucide-react";

// Menu de gauche — structure reprise de Toitures VB, intitulés adaptés plomberie.
export const NAV_GROUPS = [
  {
    id: "soumissions",
    label: "Soumissions & Projets",
    icon: Briefcase,
    items: [
      { title: "Projets", url: "/app", icon: FileText, end: true },
      { title: "Nouvelle soumission", url: "/app/quote", icon: PlusCircle },
      { title: "Calls terminés", url: "/app/calls-termines", icon: CheckCircle2 },
      { title: "Feuilles de temps", url: "/app/timesheets", icon: Clock },
    ],
  },
  {
    id: "operations",
    label: "Opérations",
    icon: Truck,
    items: [
      { title: "Clients", url: "/app/clients", icon: Users },
      { title: "Dispatch", url: "/app/dispatch", icon: Truck },
      { title: "Bons de travail", url: "/app/bons", icon: ClipboardCheck },
      { title: "Employés", url: "/app/acces", icon: HardHat },
      { title: "Contacts", url: "/app/contacts", icon: UserPlus },
    ],
  },
  {
    id: "outils",
    label: "Outils",
    icon: Wrench,
    items: [
      { title: "Calculateur de financement", url: "/app/financing", icon: Calculator },
      { title: "Assistant IA", url: "/app/assistant", icon: Bot },
      { title: "Intégration QuickBooks", url: "/app/quickbooks", icon: Plug },
    ],
  },
  {
    id: "catalogue",
    label: "Catalogue",
    icon: Package,
    items: [
      { title: "Catalogue produits", url: "/app/products", icon: Package },
      { title: "Garanties", url: "/app/warranties", icon: Shield },
      { title: "Inventaire", url: "/app/inventory", icon: Boxes },
    ],
  },
];
