import {
  Briefcase,
  FileText,
  PlusCircle,
  ClipboardList,
  ListChecks,
  Clock,
  Truck,
  Phone,
  UserPlus,
  HardHat,
  Wrench,
  Calculator,
  Bot,
  Package,
  Shield,
  Boxes,
} from "lucide-react";

// Menu de gauche — structure reprise de Toitures VB, intitulés adaptés plomberie.
export const NAV_GROUPS = [
  {
    id: "soumissions",
    label: "Soumissions & Projets",
    icon: Briefcase,
    items: [
      { title: "Projets & Leads", url: "/app", icon: FileText, end: true },
      { title: "Nouvelle soumission", url: "/app/quote", icon: PlusCircle },
      { title: "Suivi projet", url: "/app/projects", icon: ClipboardList },
      { title: "Tâches", url: "/app/tasks", icon: ListChecks },
      { title: "Feuilles de temps", url: "/app/timesheets", icon: Clock },
    ],
  },
  {
    id: "operations",
    label: "Opérations",
    icon: Truck,
    items: [
      { title: "Appels", url: "/app/call", icon: Phone },
      { title: "Dispatch", url: "/app/dispatch", icon: Truck },
      { title: "Contacts", url: "/app/contacts", icon: UserPlus },
      { title: "Embauche plombiers", url: "/app/embauche", icon: HardHat },
    ],
  },
  {
    id: "outils",
    label: "Outils",
    icon: Wrench,
    items: [
      { title: "Calculateur de financement", url: "/app/financing", icon: Calculator },
      { title: "Assistant IA", url: "/app/assistant", icon: Bot },
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
