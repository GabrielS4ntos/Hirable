import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";

type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastInput = { title: string; description?: string; variant?: ToastVariant };

const ToastContext = React.createContext<(input: ToastInput) => void>(() => {});

/** Imperative toast hook: `const toast = useToast(); toast({ title: "..." })`. */
export function useToast() {
  return React.useContext(ToastContext);
}

const ICONS: Record<ToastVariant, React.ElementType> = {
  default: Info,
  success: CheckCircle2,
  error: AlertTriangle
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const push = React.useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-3), { id, variant: "default", ...input }]);
  }, []);

  const dismiss = React.useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      <ToastPrimitive.Provider swipeDirection="right" duration={6000}>
        {children}
        {items.map((item) => {
          const Icon = ICONS[item.variant];
          return (
            <ToastPrimitive.Root
              key={item.id}
              onOpenChange={(open) => !open && dismiss(item.id)}
              className={cn(
                "animate-in-up flex items-start gap-3 rounded-lg border bg-card p-4 shadow-lg",
                item.variant === "success" && "border-success/40",
                item.variant === "error" && "border-destructive/40"
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  item.variant === "success" && "text-success",
                  item.variant === "error" && "text-destructive",
                  item.variant === "default" && "text-primary"
                )}
              />
              <div className="flex-1 space-y-1">
                <ToastPrimitive.Title className="text-sm font-medium">{item.title}</ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="text-xs break-words text-muted-foreground">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close className="text-muted-foreground transition-colors hover:text-foreground">
                <X className="size-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-100 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
