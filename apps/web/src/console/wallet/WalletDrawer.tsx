import { Drawer } from 'vaul';
import { DepositPanel } from './DepositPanel';
import { WithdrawPanel } from './WithdrawPanel';

export type WalletSheet = 'deposit' | 'withdraw' | null;

/**
 * Money in and money out, on a sheet rather than a screen.
 *
 * Both are errands, not destinations: you come in with one thing to do, do it,
 * and go back to where you were. A route makes that a journey — the run you were
 * watching is torn down, and "back" is a decision you have to make. A sheet keeps
 * the console behind it, so the errand is visibly a detour and dismissing it is a
 * swipe rather than a navigation.
 *
 * It is width-matched to the plate so it reads as part of the machine and not as
 * a web page arriving over one.
 */
export function WalletDrawer({ sheet, onClose }: { sheet: WalletSheet; onClose: () => void }) {
  return (
    <Drawer.Root open={sheet !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet__scrim" />
        <Drawer.Content className="sheet" aria-describedby={undefined}>
          <Drawer.Title className="sheet__title">
            {sheet === 'withdraw' ? 'Withdraw' : 'Deposit'}
          </Drawer.Title>
          <div className="sheet__grip" aria-hidden />
          <div className="sheet__body">
            {sheet === 'withdraw'
              ? <WithdrawPanel onBack={onClose} />
              : sheet === 'deposit' ? <DepositPanel onBack={onClose} /> : null}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
