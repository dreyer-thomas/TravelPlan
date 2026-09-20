// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MoneyField from "@/components/forms/MoneyField";
import { ECB_CURRENCIES } from "@/lib/rates/exchangeRateService";
import { expectNoHardcodedColour } from "./helpers/hardcodedColour";
import { Providers } from "./helpers/renderWithProviders";

const renderField = (props: Partial<React.ComponentProps<typeof MoneyField>> = {}) =>
  render(
    <Providers>
      <MoneyField id="cost" label="Cost" value="" onChange={() => {}} {...props} />
    </Providers>,
  );

describe("MoneyField", () => {
  it("renders a plain amount input with no selector when no currency pair is supplied", () => {
    renderField();

    expect(screen.getByLabelText("Cost")).toBeInTheDocument();
    // AC3: a payment row renders the amount alone. The absent selector is how "one selector per
    // entry" is expressed in the component's own shape rather than in a comment.
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();
  });

  it("offers EUR first and then the ECB codes alphabetically", () => {
    /*
      Sorted at the selector, not in the constant: `ECB_CURRENCIES` stays a faithful mirror of the
      feed document. The published order is four alphabetical blocks - the two majors, EU non-euro
      members, other European, then the rest - which reads as almost-sorted and puts `NZD`
      twenty-fifth of twenty-nine. Derived from the constant rather than hardcoded, because the list
      is a moving target: BGN left on euro accession, HRK before it.
    */
    renderField({ currency: "EUR", onCurrencyChange: () => {}, currencyLabel: "Currency" });

    fireEvent.mouseDown(screen.getByLabelText("Currency"));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    const codes = options.map((option) => option.textContent);

    expect(codes).toEqual(["EUR", ...[...ECB_CURRENCIES].sort()]);
    // EUR leads regardless of where it would sort, and the tail really is in order.
    expect(codes[0]).toBe("EUR");
    expect(codes.slice(1)).toEqual([...codes.slice(1)].sort());
  });

  it("reports the selected code to its owner", () => {
    const onCurrencyChange = vi.fn();
    renderField({ currency: "EUR", onCurrencyChange, currencyLabel: "Currency" });

    fireEvent.mouseDown(screen.getByLabelText("Currency"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "USD" }));

    expect(onCurrencyChange).toHaveBeenCalledWith("USD");
  });

  /**
   * Story 10.1 review. `costCurrency` accepts any non-EUR ISO code and `ECB_CURRENCIES` is a moving
   * target - BGN left the feed on euro accession, HRK before it - so an entry can hold a code this
   * list does not. Without a row of its own the selector rendered empty: the user could neither read
   * the entry's currency nor pick it again.
   */
  it("keeps a stored currency the published list no longer carries", () => {
    renderField({ currency: "BGN", onCurrencyChange: () => {}, currencyLabel: "Currency" });

    const selector = screen.getByLabelText("Currency");
    expect(selector).toHaveTextContent("BGN");

    fireEvent.mouseDown(selector);
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: "BGN" })).toBeInTheDocument();
  });

  /** The fallback is for unlisted codes only - a listed one must not be offered twice. */
  it("does not duplicate a currency the published list already carries", () => {
    renderField({ currency: "USD", onCurrencyChange: () => {}, currencyLabel: "Currency" });

    fireEvent.mouseDown(screen.getByLabelText("Currency"));
    expect(within(screen.getByRole("listbox")).getAllByRole("option", { name: "USD" })).toHaveLength(1);
  });

  /**
   * Story 10.1 review. The selector is named once, by its `aria-label`. It used to carry a visible
   * `<label htmlFor>` as well, which MUI points at a hidden input rather than the combobox - so the
   * name was announced twice and clicking the visible word opened nothing.
   */
  it("gives the selector exactly one accessible name", () => {
    renderField({ currency: "EUR", onCurrencyChange: () => {}, currencyLabel: "Currency" });

    expect(screen.getAllByLabelText("Currency")).toHaveLength(1);
  });

  it("renders the rate date under the converted figure", () => {
    renderField({
      currency: "USD",
      onCurrencyChange: () => {},
      currencyLabel: "Currency",
      convertedCaption: "≈ 87.26 €",
      rateDateCaption: "Rate of 2026-09-18",
    });

    expect(screen.getByTestId("money-field-rate-date")).toHaveTextContent("Rate of 2026-09-18");
  });

  /** A notice means there is no rate, so there is no date to show beside it either. */
  it("hides the rate date when the rate is unavailable", () => {
    const { container } = renderField({
      currency: "USD",
      onCurrencyChange: () => {},
      currencyLabel: "Currency",
      convertedCaption: "≈ 87.26 €",
      rateDateCaption: "Rate of 2026-09-18",
      notice: "Exchange rates are unavailable",
    });

    expect(container.querySelector("[data-testid='money-field-rate-date']")).toBeNull();
  });

  it("renders no caption at all on a EUR field", () => {
    const { container } = renderField({ currency: "EUR", onCurrencyChange: () => {} });

    // AC3/DESIGN: no empty slot and no reserved height - a EUR field's layout is unchanged.
    expect(container.querySelector("[data-testid='money-field-caption']")).toBeNull();
  });

  it("shows the converted figure as a caption when a rate is known", () => {
    renderField({
      currency: "USD",
      onCurrencyChange: () => {},
      convertedCaption: "≈ 87.26 €",
    });

    expect(screen.getByTestId("money-field-caption")).toHaveTextContent("≈ 87.26 €");
  });

  it("shows the rate-unavailable notice in the caption slot, not as an input error", () => {
    renderField({
      currency: "USD",
      onCurrencyChange: () => {},
      notice: "Exchange rates are unavailable - enter the price in euros.",
    });

    const caption = screen.getByTestId("money-field-caption");
    expect(caption).toHaveTextContent("Exchange rates are unavailable");
    // AC9: a notice, never the input's error treatment.
    expect(screen.getByLabelText("Cost")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("prefers the notice over the converted caption when both could apply", () => {
    renderField({
      currency: "USD",
      onCurrencyChange: () => {},
      convertedCaption: "≈ 87.26 €",
      notice: "Exchange rates are unavailable",
    });

    expect(screen.getByTestId("money-field-caption")).toHaveTextContent("Exchange rates are unavailable");
    expect(screen.getByTestId("money-field-caption")).not.toHaveTextContent("87.26");
  });

  it("falls back to the field's own hint when there is nothing to convert", () => {
    renderField({ hint: "Total for the whole stay" });

    expect(screen.getByText("Total for the whole stay")).toBeInTheDocument();
  });

  it("still renders the field's error line through FormField", () => {
    renderField({ error: "Enter a valid amount" });

    expect(screen.getByText("Enter a valid amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Cost")).toHaveAttribute("aria-invalid", "true");
  });

  it("holds no colour literal", () => {
    expectNoHardcodedColour("src/components/forms/MoneyField.tsx");
  });
});
