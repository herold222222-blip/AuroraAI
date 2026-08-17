export function openFilePicker(input: HTMLInputElement | null | undefined) {
  if (!input) return;
  try {
    input.showPicker?.();
    return;
  } catch {
    /* fall through */
  }
  input.click();
}
