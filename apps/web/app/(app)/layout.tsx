import AppShell from '@/components/AppShell';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { CallProvider } from '@/components/CallProvider';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <CallProvider>
        <AppShell>{children}</AppShell>
      </CallProvider>
    </ConfirmProvider>
  );
}
