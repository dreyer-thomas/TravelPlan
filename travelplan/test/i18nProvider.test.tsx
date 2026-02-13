// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "@/i18n/provider";

type ProbeProps = {
  labelKey: string;
};

const Probe = ({ labelKey }: ProbeProps) => {
  const { language, t } = useI18n();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="label">{t(labelKey)}</span>
    </div>
  );
};

describe("I18nProvider", () => {
  it("provides language and translations", () => {
    render(
      <I18nProvider initialLanguage="de">
        <Probe labelKey="demo.title" />
      </I18nProvider>
    );

    expect(screen.getByTestId("language")).toHaveTextContent("de");
    expect(screen.getByTestId("label")).toHaveTextContent("Mit ruhiger Klarheit planen");
  });
});
