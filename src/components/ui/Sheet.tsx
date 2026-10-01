"use client";

import Dialog, { type DialogProps } from "./Dialog";

/*
 * --- site-redesign --- A modal sheet: the Dialog anchored to an edge (the header's menu on small screens slides in from
 * the right, a bottom sheet on phones). Same focus trap, Esc, scrim and focus return as the Dialog.
 */
export default function Sheet({ side = "right", ...props }: Omit<DialogProps, "placement"> & { side?: "right" | "bottom" }) {
  return <Dialog placement={side} {...props} />;
}
