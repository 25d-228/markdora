import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("application shell", () => {
  it("renders the product name in the header", () => {
    render(<App />);

    expect(screen.getByRole("banner")).toHaveTextContent("Markdora");
  });

  it("renders the empty state in the main workspace", () => {
    render(<App />);

    const workspace = screen.getByRole("main");
    expect(
      within(workspace).getByRole("heading", { name: "No document open" }),
    ).toBeInTheDocument();
    expect(
      within(workspace).getByText(
        "Open or create a Markdown document to begin.",
      ),
    ).toBeInTheDocument();
  });

  it("exposes semantic header and main regions", () => {
    render(<App />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
