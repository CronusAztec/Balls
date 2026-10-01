"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { cx } from "./cx";
import { IconClose } from "./icons";

/*
 * --- site-redesign --- A modal dialog on the native <dialog> element (showModal): the rest of the page is inert while it
 * is open, so the focus stays inside; Esc and a click on the scrim close it; the focus goes back to whatever opened it.
 * Render it only while it is open ({open && <Dialog …/>}) – nothing of it stays in the page when closed.
 *
 * `placement`: "center" (palette, picker) or "bottom" / "right" sheets (the header's mobile menu).
 */
export interface DialogProps {
  onClose: () => void;
  /** The dialog's name (shown as its heading unless `hideTitle`). */
  title: string;
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  placement?: "center" | "top" | "bottom" | "right";
  /** The element to focus first (else the first focusable element inside). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** The close button's name (translated; the button is left out with `hideTitle` – Esc and the scrim close it). */
  closeLabel: string;
  /** Extra content on the header's right, before the close button. */
  headerAside?: ReactNode;
  id?: string;
}

const PLACEMENT: Record<NonNullable<DialogProps["placement"]>, string> = {
  center: "m-auto w-[min(960px,calc(100vw-32px))] max-h-[min(760px,calc(100dvh-32px))] rounded-xl",
  top: "mx-auto mt-[12vh] mb-auto w-[min(640px,calc(100vw-32px))] max-h-[min(560px,calc(100dvh-24vh))] rounded-xl",
  bottom: "mt-auto mb-0 mx-0 w-full max-w-none max-h-[85dvh] rounded-t-xl",
  right: "ml-auto mr-0 my-0 h-dvh max-h-none w-[min(360px,100vw)] rounded-none",
};

export default function Dialog({ onClose, title, hideTitle = false, children, className, bodyClassName, placement = "center", initialFocus, closeLabel, headerAside, id }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const first = initialFocus?.current ?? dialog.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button:not([data-dialog-close]), [href], [tabindex]:not([tabindex='-1'])");
    first?.focus();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      // Back to the control that opened the dialog (when it is still in the page and nothing else took the focus).
      if (opener && opener.isConnected && (document.activeElement === document.body || document.activeElement === null)) opener.focus();
    };
    // Opened once per mount; the focus target is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      id={id}
      aria-modal="true"
      aria-labelledby={titleId}
      className={cx("ui-dialog fixed inset-0 overflow-hidden border-0 bg-surface-1 p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-transparent", PLACEMENT[placement], className)}
      onMouseDown={(e) => {
        // A press on the scrim (the dialog element itself, outside its content) closes it.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div className="flex max-h-[inherit] h-full flex-col">
        {hideTitle ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
            <h2 id={titleId} className="min-w-0 flex-1 truncate font-sans text-md font-medium tracking-normal text-ink">
              {title}
            </h2>
            {headerAside}
            <button
              type="button"
              data-dialog-close=""
              onClick={() => onCloseRef.current()}
              aria-label={closeLabel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink cursor-pointer [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <IconClose />
            </button>
          </div>
        )}
        <div className={cx("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
      </div>
    </dialog>
  );
}
