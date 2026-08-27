import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WalletButton } from "./WalletButton";
import { ThemeToggle } from "./ThemeToggle";
import CopyButton from "./CopyButton";
import { ProofProgress } from "./ProofProgress";
import { Timeline } from "./Timeline";

// Mock wallet context
vi.mock("@/lib/wallet-context", () => ({
  useWallet: () => ({
    address: null,
    connecting: false,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe("Accessibility Pass - Components ARIA Semantics", () => {
  it("WalletButton renders with accessible label", () => {
    render(<WalletButton />);
    const button = screen.getByRole("button", { name: /connect wallet/i });
    expect(button).toBeInTheDocument();
  });

  it("ThemeToggle renders with button role and aria-label", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /switch to/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed");
  });

  it("CopyButton renders with accessible label", () => {
    render(<CopyButton value="test-copy" />);
    const button = screen.getByRole("button", { name: /copy/i });
    expect(button).toBeInTheDocument();
  });

  it("ProofProgress exposes list semantics and active step indicator", () => {
    render(
      <ProofProgress
        steps={[
          { label: "Step 1", status: "done" },
          { label: "Step 2", status: "active" },
          { label: "Step 3", status: "pending" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: /proof progress/i });
    expect(list).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute("aria-current", "step");
  });

  it("Timeline exposes list semantics and link labels", () => {
    render(
      <Timeline
        events={[
          { stage: "issued", timestamp: 1700000000 },
          { stage: "submitted", timestamp: 1700000100, txHash: "0123456789abcdef0123456789abcdef" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: /proof event history/i });
    expect(list).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view transaction/i });
    expect(link).toBeInTheDocument();
  });
});
