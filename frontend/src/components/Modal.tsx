import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PropsWithChildren, ReactNode } from "react";

type ModalSize = "md" | "lg" | "xl" | "fullscreen";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  size?: ModalSize;
  footer?: ReactNode;
}

const focusableSelector =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])';

export const Modal = ({ open, title, onClose, size = "lg", footer, children }: PropsWithChildren<ModalProps>) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    const root = dialogRef.current;
    const focusables = root.querySelectorAll<HTMLElement>(focusableSelector);
    const first = focusables[0];
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const current = root.querySelectorAll<HTMLElement>(focusableSelector);
      if (current.length === 0) {
        return;
      }
      const activeIndex = Array.from(current).indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey) {
        if (activeIndex <= 0) {
          event.preventDefault();
          current[current.length - 1]?.focus();
        }
        return;
      }
      if (activeIndex === current.length - 1) {
        event.preventDefault();
        current[0]?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="modal__header">
          <h3>{title}</h3>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close dialog">
            x
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
};
