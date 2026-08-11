import { createContext, useCallback, useContext, useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState({ open: false, title: '', description: '', confirmText: 'Confirm', variant: 'destructive', onConfirm: null });
  const resolveRef = useRef(null);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({
        open: true,
        title: options.title || 'Are you sure?',
        description: options.description || 'This action cannot be undone.',
        confirmText: options.confirmText || 'Confirm',
        variant: options.variant || 'destructive',
      });
    });
  }, []);

  function handleConfirm() {
    setDialog((d) => ({ ...d, open: false }));
    resolveRef.current?.(true);
    resolveRef.current = null;
  }

  function handleCancel() {
    setDialog((d) => ({ ...d, open: false }));
    resolveRef.current?.(false);
    resolveRef.current = null;
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={dialog.open} onOpenChange={(open) => { if (!open) handleCancel(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.title}</DialogTitle>
            <DialogDescription>{dialog.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>Cancel</Button>
            <Button variant={dialog.variant} onClick={handleConfirm}>
              {dialog.confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
