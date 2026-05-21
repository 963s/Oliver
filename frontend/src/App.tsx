import { useEffect } from "react";
import { PrintPaperFX } from "./components/organisms/PrintPaperFX";
import { ToastStack } from "./components/ui/ToastStack";
import { initUiShellMedia } from "./store/uiShellStore";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ScanDeduct } from "./ScanDeduct";
import { AgendaView } from "./pages/AgendaView";
import { Bookings } from "./pages/Bookings";
import { WalkIn } from "./pages/WalkIn";
import { MirrorView } from "./pages/MirrorView";
import { Estimate } from "./pages/Estimate";
import { Inventur } from "./pages/Inventur";
import { Rings } from "./pages/Rings";
import { SettingsPage } from "./pages/SettingsPage";
import { Reconcile } from "./pages/Reconcile";
import { PairingScreen } from "./pages/PairingScreen";
import { LoginScreen } from "./pages/LoginScreen";
import { initAuthConnectivityListeners, useAuthStore } from "./store/authStore";
import { DashboardLayout } from "./pages/Dashboard";
import { DashboardHome } from "./pages/DashboardHome";
import { DailyClosing } from "./pages/DailyClosing";
import { AdminDashboard } from "./pages/AdminDashboard";
import { WareneingangView } from "./pages/WareneingangView";
import { AdminSettings } from "./pages/AdminSettings";
import { AdminReports } from "./pages/AdminReports";
import { StaffPerformance } from "./pages/StaffPerformance";
import { RequireSalonManagement } from "./components/auth/RequireSalonManagement";
import { AdminDiagnostics } from "./pages/AdminDiagnostics";
import { HelpHandbuch } from "./pages/HelpHandbuch";
import { EmbeddedDesktopGate } from "./shell/EmbeddedDesktopGate";
import { UpdateBanner } from "./components/UpdateBanner";

function AppRoutes() {
  const isPaired = useAuthStore((s) => s.isPaired);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const rehydrate = useAuthStore((s) => s.rehydrate);

  useEffect(() => {
    initAuthConnectivityListeners();
    rehydrate();
  }, [rehydrate]);

  if (!isPaired) {
    return (
      <Routes>
        <Route path="/pair" element={<PairingScreen />} />
        <Route path="*" element={<Navigate to="/pair" replace />} />
      </Routes>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<DashboardLayout />}>
        <Route index element={<DashboardHome />} />
        <Route path="agenda" element={<AgendaView />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="walk-in" element={<WalkIn />} />
        <Route path="scan" element={<ScanDeduct />} />
        <Route path="mirror" element={<MirrorView />} />
        <Route path="estimate" element={<Estimate />} />
        <Route path="session-demo" element={<Navigate to="/walk-in" replace />} />
        <Route path="inventur" element={<Inventur />} />
        <Route path="reconcile" element={<Reconcile />} />
        <Route path="rings" element={<Rings />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="handbuch" element={<HelpHandbuch />} />
        <Route
          path="daily-closing"
          element={
            <RequireSalonManagement>
              <DailyClosing />
            </RequireSalonManagement>
          }
        />
        <Route
          path="admin"
          element={
            <RequireSalonManagement>
              <AdminDashboard />
            </RequireSalonManagement>
          }
        />
        <Route
          path="admin/wareneingang"
          element={
            <RequireSalonManagement>
              <WareneingangView />
            </RequireSalonManagement>
          }
        />
        <Route
          path="admin/settings"
          element={
            <RequireSalonManagement>
              <AdminSettings />
            </RequireSalonManagement>
          }
        />
        <Route
          path="admin/reports"
          element={
            <RequireSalonManagement>
              <AdminReports />
            </RequireSalonManagement>
          }
        />
        <Route
          path="admin/diagnostics"
          element={
            <RequireSalonManagement>
              <AdminDiagnostics />
            </RequireSalonManagement>
          }
        />
        <Route path="staff-performance" element={<StaffPerformance />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  useEffect(() => {
    initUiShellMedia();
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <EmbeddedDesktopGate>
          <div className="h-screen w-screen overflow-hidden bg-canvas-white">
            <AppRoutes />
          </div>
        </EmbeddedDesktopGate>
        <ToastStack />
        <PrintPaperFX />
        <UpdateBanner />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
