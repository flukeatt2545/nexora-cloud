import type { CompositionEvent, FormEvent, InputHTMLAttributes } from "react";

/** Printable ASCII only — blocks Thai, emoji, and other non-Latin scripts. */
export function filterAsciiInput(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "");
}

export function filterLatinAlphanumeric(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "");
}

export function hasNonAscii(value: string): boolean {
  return /[^\x20-\x7E]/.test(value);
}

type AsciiInputOptions = {
  onValueChange?: (value: string) => void;
};

export function asciiInputProps(options: AsciiInputOptions = {}): Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "lang" | "autoCorrect" | "autoCapitalize" | "spellCheck" | "onBeforeInput" | "onChange" | "onCompositionEnd"
> {
  const { onValueChange } = options;

  return {
    lang: "en",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    onBeforeInput: (event) => {
      const data = (event.nativeEvent as InputEvent).data;
      if (data && /[^\x20-\x7E]/.test(data)) {
        event.preventDefault();
      }
    },
    onChange: (event) => {
      const filtered = filterAsciiInput(event.currentTarget.value);
      if (filtered !== event.currentTarget.value) {
        event.currentTarget.value = filtered;
      }
      onValueChange?.(filtered);
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
      const filtered = filterAsciiInput(event.currentTarget.value);
      if (filtered !== event.currentTarget.value) {
        event.currentTarget.value = filtered;
      }
      onValueChange?.(filtered);
    },
  };
}

export function latinAlphanumericInputProps(options: AsciiInputOptions = {}): Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "lang" | "autoCorrect" | "autoCapitalize" | "spellCheck" | "onBeforeInput" | "onChange" | "onCompositionEnd"
> {
  const { onValueChange } = options;

  return {
    lang: "en",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    onBeforeInput: (event: FormEvent<HTMLInputElement>) => {
      const data = (event.nativeEvent as InputEvent).data;
      if (data && /[^A-Za-z0-9]/.test(data)) {
        event.preventDefault();
      }
    },
    onChange: (event) => {
      const filtered = filterLatinAlphanumeric(event.currentTarget.value);
      if (filtered !== event.currentTarget.value) {
        event.currentTarget.value = filtered;
      }
      onValueChange?.(filtered);
    },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
      const filtered = filterLatinAlphanumeric(event.currentTarget.value);
      if (filtered !== event.currentTarget.value) {
        event.currentTarget.value = filtered;
      }
      onValueChange?.(filtered);
    },
  };
}
