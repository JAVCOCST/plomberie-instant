import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/AdminLogin";
import AdminLayout from "./pages/AdminLayout";
import AdminDashboard from "./pages/AdminDashboard";
import AdminQuoteGenerator from "./pages/AdminQuoteGenerator";
import SignContract from "./pages/SignContract";
const AdminRoofPolygonAI = lazy(() => import("./pages/AdminRoofPolygonAI"));
const AdminRoofStudio = lazy(() => import("./pages/AdminRoofStudio"));
const AdminSolarViewer = lazy(() => import("./pages/AdminSolarViewer"));
import AdminProducts from "./pages/AdminProducts";
import AdminContacts from "./pages/AdminContacts";
import AdminWarranties from "./pages/AdminWarranties";
import AdminDiagnostics from "./pages/AdminDiagnostics";
import SuiviProjets from "./pages/SuiviProjets";
import AdminTasks from "./pages/AdminTasks";
import AdminDispatch from "./pages/AdminDispatch";
import AdminWeatherRadar from "./pages/AdminWeatherRadar";
import AdminReviewRequests from "./pages/AdminReviewRequests";
import AdminTrainingLab from "./pages/AdminTrainingLab";
import AdminBatchesDashboard from "./pages/AdminBatchesDashboard";
import AdminModelsDashboard from "./pages/AdminModelsDashboard";
import AdminMarieve from "./pages/AdminMarieve";
import AdminFinancing from "./pages/AdminFinancing";
import AdminEmbauche from "./pages/AdminEmbauche";
import AdminTimesheets from "./pages/AdminTimesheets";
import AdminCallModule from "./pages/AdminCallModule";
import Embauche from "./pages/Embauche";
import EmbaucheMerci from "./pages/EmbaucheMerci";
import SplashScreen from "./components/SplashScreen";
import { unlockAudioFeedback } from "./lib/audioFeedback";

const queryClient = new QueryClient();

const App = () => {
  const [showSplash, setShowSplash] = useState(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
    if (!isStandalone) return false;
    // Mobile-only — never show on desktop, even in standalone (e.g. Chrome PWA)
    const isMobile = window.matchMedia('(max-width: 767px)').matches
      || (typeof window !== 'undefined' && 'ontouchstart' in window && window.innerWidth < 900);
    if (!isMobile) return false;
    // Only show once per session (not on every refresh)
    const key = '__vb_splash_shown';
    if (sessionStorage.getItem(key)) return false;
    return true;
  });

  const hideSplash = useCallback(() => {
    try { sessionStorage.setItem('__vb_splash_shown', '1'); } catch {}
    setShowSplash(false);
  }, []);

  useEffect(() => {
    const unlock = () => { unlockAudioFeedback(); };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AnimatePresence>
          {showSplash && <SplashScreen onDone={hideSplash} />}
        </AnimatePresence>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/embauche" element={<Embauche />} />
            <Route path="/embauche/merci" element={<EmbaucheMerci />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/sign/:token" element={<SignContract />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="quote" element={<AdminQuoteGenerator />} />
              <Route
                path="quote/roof-polygon"
                element={
                  <Suspense fallback={<div className="p-6 text-sm text-zinc-400">Chargement de RoofPolygon AI…</div>}>
                    <AdminRoofPolygonAI />
                  </Suspense>
                }
              />
              <Route path="projects" element={<SuiviProjets />} />
              <Route path="tasks" element={<AdminTasks />} />
              <Route path="dispatch" element={<AdminDispatch />} />
              <Route path="call" element={<AdminCallModule />} />
              <Route path="radar" element={<AdminWeatherRadar />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="contacts" element={<AdminContacts />} />
              <Route path="timesheets" element={<AdminTimesheets />} />
              <Route path="warranties" element={<AdminWarranties />} />
              <Route path="reviews" element={<AdminReviewRequests />} />
              <Route path="diagnostics" element={<AdminDiagnostics />} />
              <Route path="training-lab" element={<AdminTrainingLab />} />
              <Route path="training-lab/batches" element={<AdminBatchesDashboard />} />
              <Route path="training-lab/models" element={<AdminModelsDashboard />} />
              <Route path="marieve" element={<AdminMarieve />} />
              <Route path="embauche" element={<AdminEmbauche />} />
              <Route path="financing" element={<AdminFinancing />} />
              <Route
                path="roof-studio"
                element={
                  <Suspense fallback={<div className="p-6 text-sm text-zinc-400">Chargement du traceur 3D…</div>}>
                    <AdminRoofStudio />
                  </Suspense>
                }
              />
              <Route
                path="solar-3d"
                element={
                  <Suspense fallback={<div className="p-6 text-sm text-zinc-400">Chargement du Solar 3D viewer…</div>}>
                    <AdminSolarViewer />
                  </Suspense>
                }
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
