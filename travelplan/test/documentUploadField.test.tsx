// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DocumentUploadField, { type DocumentPreview } from "@/components/forms/DocumentUploadField";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/lib/trips/documentUploads";
import { renderWithProviders } from "./helpers/renderWithProviders";

const FIELD_ID = "stay-documents";
const LABEL = "Documents";
const ZONE_TITLE = "Choose documents";
const ZONE_HINT = "PDF, JPEG, PNG or WebP, up to 10 MB each";

const renderField = (
  overrides: Partial<Omit<React.ComponentProps<typeof DocumentUploadField>, "onFilesSelected">> = {},
) => {
  const onFilesSelected = vi.fn<(files: File[]) => void>();
  renderWithProviders(
    <DocumentUploadField
      id={FIELD_ID}
      label={LABEL}
      zoneTitle={ZONE_TITLE}
      zoneHint={ZONE_HINT}
      accept={DOCUMENT_UPLOAD_ACCEPT}
      multiple
      documents={[]}
      {...overrides}
      onFilesSelected={onFilesSelected}
    />,
  );
  return { onFilesSelected };
};

const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });

describe("DocumentUploadField", () => {
  it("names the file input by its caps label and describes it with both copy lines", () => {
    renderField();

    // The caps `<label htmlFor>` is the field's single accessible name — the same scheme
    // `PhotoUploadField` uses, so the zone's own copy never becomes part of the name.
    const input = screen.getByLabelText(LABEL);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("id", FIELD_ID);
    expect(input).toHaveAttribute("accept", DOCUMENT_UPLOAD_ACCEPT);

    // Both lines are described, not merely shown: the 10 MB ceiling and the accepted formats have to
    // reach a non-sighted user before they pick a file, not after a rejected upload.
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    expect(describedBy).toHaveLength(2);
    const describedText = describedBy.map((id) => document.getElementById(id)?.textContent);
    expect(describedText).toEqual([ZONE_TITLE, ZONE_HINT]);
  });

  it("hands the picked files to the caller", async () => {
    const user = userEvent.setup();
    const { onFilesSelected } = renderField();

    await user.upload(screen.getByLabelText(LABEL), [pdf("Ticket Rom.pdf"), pdf("Hotel.pdf")]);

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    expect(onFilesSelected.mock.calls[0][0].map((file) => file.name)).toEqual([
      "Ticket Rom.pdf",
      "Hotel.pdf",
    ]);
  });

  /**
   * DW-52, the defect this field must not ship a second copy of.
   *
   * A file input fires `change` only when the *selection* changes, so without the reset the sequence
   * pick → upload → remove → pick the same file again produces no event at all: the staged list stays
   * empty and Upload stays disabled with no way out but reopening the dialog. The same `File` object
   * is uploaded twice here on purpose — that is exactly the case a browser (and `userEvent.upload`,
   * which compares the incoming files against `input.files`) treats as "no change".
   */
  it("clears the input after each selection so the same file can be picked again", async () => {
    const user = userEvent.setup();
    const { onFilesSelected } = renderField();

    const input = screen.getByLabelText(LABEL) as HTMLInputElement;
    const sameFile = pdf("Ticket Rom.pdf");

    await user.upload(input, sameFile);
    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
    expect(input.files).toHaveLength(0);

    await user.upload(input, sameFile);
    expect(onFilesSelected).toHaveBeenCalledTimes(2);
  });

  it("renders one chip per document with a remove control that names its position", async () => {
    const user = userEvent.setup();
    const onRemoveFirst = vi.fn();
    const onRemoveSecond = vi.fn();
    // Deliberately the same file name on both rows: the remove buttons must still be tellable apart.
    const documents: DocumentPreview[] = [
      { key: "d1", documentUrl: "/uploads/a/one.pdf", fileName: "Ticket.pdf", onRemove: onRemoveFirst },
      { key: "d2", documentUrl: "/uploads/a/two.pdf", fileName: "Ticket.pdf", onRemove: onRemoveSecond },
    ];
    renderField({ documents });

    const chips = screen.getAllByRole("link");
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => chip.getAttribute("href"))).toEqual([
      "/uploads/a/one.pdf",
      "/uploads/a/two.pdf",
    ]);

    const removeButtons = screen.getAllByRole("button");
    expect(removeButtons).toHaveLength(2);
    const names = removeButtons.map((button) => button.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);

    await user.click(removeButtons[1]);
    expect(onRemoveSecond).toHaveBeenCalledTimes(1);
    expect(onRemoveFirst).not.toHaveBeenCalled();
  });

  it("renders no remove control for a document the caller made read-only", () => {
    renderField({
      documents: [{ key: "d1", documentUrl: "/uploads/a/one.pdf", fileName: "Ticket.pdf" }],
    });

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the empty line, and no chips, when there are no documents", () => {
    renderField({ documents: [], emptyLabel: "No documents yet." });

    expect(screen.getByText("No documents yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("hides the empty line once a document exists", () => {
    renderField({
      documents: [{ key: "d1", documentUrl: "/uploads/a/one.pdf", fileName: "Ticket.pdf" }],
      emptyLabel: "No documents yet.",
    });

    expect(screen.queryByText("No documents yet.")).toBeNull();
  });

  it("renders the caller's selection line and action", () => {
    renderField({ selectionLabel: "2 file(s) selected", action: <button type="button">Upload</button> });

    expect(screen.getByText("2 file(s) selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
  });
});
