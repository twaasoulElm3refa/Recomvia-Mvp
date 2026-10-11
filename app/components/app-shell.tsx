"use client";

import { useSiteLocale } from "@/hooks/use-site-locale";
import { storeSiteLocale } from "@/lib/site-locale";
import type { ReactNode } from "react";
import { NavigationLink as Link } from "@/app/components/navigation-link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  BookOpenCheck,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Sparkles,
  Wrench,
} from "lucide-react";
import { BrandMark } from "@/app/scan-experience";
import { KnowledgeAssistant } from "@/app/components/knowledge-assistant";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const nav = [
  {
    href: "/dashboard",
    label: "Overview",
    labelAr: "نظرة عامة",
    icon: LayoutDashboard,
  },
  {
    href: "/report",
    label: "Visibility report",
    labelAr: "تقرير الظهور",
    icon: FileSearch,
  },
  {
    href: "/fix-center",
    label: "Fix Center",
    labelAr: "مركز الإصلاح",
    icon: Wrench,
  },
  { href: "/blog", label: "Blog", labelAr: "المدونة", icon: BookOpen },
  {
    href: "/faq",
    label: "FAQ & help",
    labelAr: "الأسئلة والمساعدة",
    icon: CircleHelp,
  },
  {
    href: "/pricing",
    label: "Subscriptions & credits",
    labelAr: "الاشتراكات والنقاط",
    icon: CreditCard,
  },
  {
    href: "/methodology",
    label: "Methodology",
    labelAr: "المنهجية",
    icon: BookOpenCheck,
  },
  { href: "/contact", label: "Contact us", labelAr: "اتصل بنا", icon: Mail },
];

function Navigation() {
  const path = usePathname();
  const ar = useSiteLocale() === "ar";
  return (
    <nav className="space-y-1">
      {nav.map(({ href, label, labelAr, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition ${path === href ? "bg-blue-600 text-white shadow-[0_10px_28px_rgba(37,99,235,.28)]" : "text-slate-400 hover:bg-white/[.06] hover:text-white"}`}
        >
          <Icon className="size-[18px]" />
          {ar ? labelAr : label}
        </Link>
      ))}
    </nav>
  );
}

function Sidebar() {
  const ar = useSiteLocale() === "ar";
  return (
    <div className="flex h-full flex-col bg-[#07111f] p-4 text-white">
      <Link href="/" className="mb-8 block rounded-xl bg-white px-3 py-2.5">
        <BrandMark />
      </Link>
      <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">
        {ar ? "مساحة العمل" : "Workspace"}
      </p>
      <Navigation />
      <div className="mt-auto rounded-2xl border border-white/10 bg-white/[.045] p-4">
        <p className="flex items-center gap-2 text-xs font-bold text-cyan-300">
          <Sparkles className="size-3.5" />
          {ar ? "نسخة تجريبية خاصة" : "Private beta"}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          {ar
            ? "النتائج مبنية على الفحوص المكتملة. تحليل الأسماء والموضوعات يتطلب تفعيل المحرك؛ الدفع لم يُفعّل بعد."
            : "Results reflect completed tests. Name and topic analysis requires engine activation; billing is not active yet."}
        </p>
      </div>
    </div>
  );
}

export function AppShell({
  title,
  description,
  action,
  children,
  workspaceLabel = "Private beta workspace",
  siteLabel = "Run a live scan to create evidence",
  userInitial = "R",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  workspaceLabel?: string;
  siteLabel?: string;
  userInitial?: string;
}) {
  const ar = useSiteLocale() === "ar";
  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      lang={ar ? "ar" : "en"}
      className="min-h-screen bg-slate-50 text-[#07111f]"
    >
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-[250px] lg:block">
        <Sidebar />
      </aside>
      <div className="lg:ps-[250px]">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
          <div className="flex h-[68px] items-center justify-between px-5 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="rounded-xl lg:hidden"
                  >
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side={ar ? "right" : "left"}
                  className="w-[280px] border-0 bg-[#07111f] p-0"
                >
                  <SheetHeader className="sr-only">
                    <SheetTitle>{ar ? "القائمة" : "Navigation"}</SheetTitle>
                  </SheetHeader>
                  <Sidebar />
                </SheetContent>
              </Sheet>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{workspaceLabel}</p>
                <p className="truncate text-xs text-slate-500">{siteLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 sm:inline-flex">
                {ar ? "أدلة محفوظة" : "Stored evidence"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => storeSiteLocale(ar ? "en" : "ar")}
              >
                {ar ? "EN" : "العربية"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="rounded-xl px-2"
                    aria-label={ar ? "فتح قائمة الحساب" : "Open account menu"}
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-[#07111f] text-xs font-bold text-white">
                      {userInitial.slice(0, 1).toUpperCase()}
                    </span>
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem asChild>
                    <a href="/auth/signout" className="cursor-pointer">
                      <LogOut className="size-4" />
                      {ar ? "تسجيل الخروج" : "Sign out"}
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <main className="px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-[1280px]">
            <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-blue-600">
                  <BarChart3 className="size-3.5" />
                  {ar
                    ? "مساحة الظهور في الذكاء الاصطناعي"
                    : "AI visibility workspace"}
                </p>
                <h1 className="text-3xl font-extrabold tracking-[-.04em] sm:text-4xl">
                  {title}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">
                  {description}
                </p>
              </div>
              {action}
            </div>
            {children}
          </div>
        </main>
      </div>
      <KnowledgeAssistant />
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "good" | "warn" | "bad" | "info";
  children: ReactNode;
}) {
  const tones = {
    good: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    bad: "bg-red-50 text-red-700 border-red-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
