// Shared mocks for shadcn/ui components that use base-ui (incompatible with jsdom).
// Loaded via vitest.config.js setupFiles so all test files get these automatically.

// ─── ConfirmContext: provide a mock confirm that auto-resolves ──
vi.mock('@/contexts/ConfirmContext.jsx', () => ({
  ConfirmProvider: ({ children }) => <>{children}</>,
  useConfirm: () => async (options) => true,
}));

// ─── shadcn/ui component mocks (base-ui is incompatible with jsdom) ──

vi.mock('@/components/ui/button.jsx', () => ({
  Button: ({ children, onClick, disabled, variant, size, className, ...props }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size} className={className} {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/input.jsx', () => {
  const React = require('react');
  return {
    Input: React.forwardRef(({ value, onChange, ...props }, ref) => (
      <input ref={ref} value={value} onChange={onChange} {...props} />
    )),
  };
});

vi.mock('@/components/ui/label.jsx', () => ({
  Label: ({ children, ...props }) => <label {...props}>{children}</label>,
}));

vi.mock('@/components/ui/textarea.jsx', () => {
  const React = require('react');
  return {
    Textarea: React.forwardRef(({ value, onChange, ...props }, ref) => (
      <textarea ref={ref} value={value} onChange={onChange} {...props} />
    )),
  };
});

vi.mock('@/components/ui/select.jsx', () => {
  const React = require('react');
  const Ctx = React.createContext(() => {});
  return {
    Select: ({ children, value, onValueChange }) => (
      <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>
    ),
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ children, value }) => {
      const onChange = React.useContext(Ctx);
      return <button type="button" data-value={value} onClick={() => onChange(value)}>{children}</button>;
    },
    SelectTrigger: ({ children, ...props }) => <button {...props}>{children}</button>,
    SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
  };
});

vi.mock('@/components/ui/switch.jsx', () => ({
  Switch: ({ checked, onCheckedChange, disabled, ...props }) => (
    <input type="checkbox" role="switch" checked={checked} onChange={(e) => onCheckedChange?.(e.target.checked)} disabled={disabled} {...props} />
  ),
}));

vi.mock('@/components/ui/badge.jsx', () => ({
  Badge: ({ children, variant, ...props }) => <span data-variant={variant} {...props}>{children}</span>,
}));

vi.mock('@/components/ui/skeleton.jsx', () => ({
  Skeleton: (props) => <div data-testid="skeleton" {...props} />,  // eslint-disable-line
}));

vi.mock('@/components/ui/separator.jsx', () => ({
  Separator: () => <hr />,
}));

vi.mock('@/components/ui/card.jsx', () => ({
  Card: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
  CardContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardFooter: ({ children, ...props }) => <div {...props}>{children}</div>,
}));

vi.mock('@/components/ui/tabs.jsx', () => {
  const React = require('react');
  const Ctx = React.createContext(() => {});
  return {
    Tabs: ({ children, value, onValueChange }) => (
      <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>
    ),
    TabsList: ({ children, ...props }) => <div role="tablist" {...props}>{children}</div>,
    TabsTrigger: ({ children, value, ...props }) => {
      const onChange = React.useContext(Ctx);
      return <button type="button" role="tab" data-value={value} aria-selected={value === props?.['data-state'] || undefined} onClick={() => onChange(value)} {...props}>{children}</button>;
    },
    TabsContent: ({ children, value, ...props }) => <div role="tabpanel" data-value={value} {...props}>{children}</div>,
  };
});

vi.mock('@/components/ui/tooltip.jsx', () => ({
  TooltipProvider: ({ children }) => <>{children}</>,
  Tooltip: ({ children }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild, ...props }) => asChild ? children : <span {...props}>{children}</span>,
  TooltipContent: ({ children, ...props }) => <span {...props}>{children}</span>,
}));

vi.mock('@/components/ui/scroll-area.jsx', () => ({
  ScrollArea: ({ children, ...props }) => <div {...props}>{children}</div>,
}));

vi.mock('@/components/ui/dialog.jsx', () => ({
  Dialog: ({ children, open, onOpenChange }) => open ? <div role="dialog" data-open>{children}</div> : null,
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  DialogDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
  DialogFooter: ({ children, ...props }) => <div {...props}>{children}</div>,
}));

vi.mock('@/components/ui/sheet.jsx', () => ({
  Sheet: ({ children, open, onOpenChange }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  SheetHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
  SheetTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  SheetDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
}));

vi.mock('@/components/ui/table.jsx', () => ({
  Table: ({ children, ...props }) => <table {...props}>{children}</table>,
  TableBody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
  TableCell: ({ children, ...props }) => <td {...props}>{children}</td>,
  TableHead: ({ children, ...props }) => <th {...props}>{children}</th>,
  TableHeader: ({ children, ...props }) => <thead {...props}>{children}</thead>,
  TableRow: ({ children, ...props }) => <tr {...props}>{children}</tr>,
}));

vi.mock('@/components/ui/dropdown-menu.jsx', () => ({
  DropdownMenu: ({ children }) => <>{children}</>,
  DropdownMenuTrigger: ({ children, asChild, ...props }) => asChild ? children : <button {...props}>{children}</button>,
  DropdownMenuContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DropdownMenuItem: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/alert.jsx', () => ({
  Alert: ({ children, ...props }) => <div role="alert" {...props}>{children}</div>,
  AlertTitle: ({ children, ...props }) => <div {...props}>{children}</div>,
  AlertDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
