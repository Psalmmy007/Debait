// Non-modal popovers: focus enters, Escape closes, and focus returns to the opener.
// No focus trap: the page remains available to keyboard users.
export function focusPopover(el) {
  const opener = document.activeElement?.shadowRoot?.activeElement || document.activeElement;
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
  return () => {
    const root = el.getRootNode();
    const active = root.activeElement || document.activeElement;
    if ((active === el || el.contains(active)) && opener?.isConnected) opener.focus({ preventScroll: true });
  };
}
