import PlatformShell from '@/components/PlatformShell';
import { ConfirmProvider } from '@/components/ConfirmProvider';

// The Platform Console sits above every customer workspace, so it deliberately
// does not mount CallProvider — nobody here has an extension to register.
export default function PlatformGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <PlatformShell>{children}</PlatformShell>
    </ConfirmProvider>
  );
}
