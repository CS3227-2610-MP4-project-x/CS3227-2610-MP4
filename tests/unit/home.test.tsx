import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "../../src/app/page";

describe("App Router home page scaffold", () => {
  it("renders the setup page with its accessible heading", () => {
    const markup = renderToStaticMarkup(createElement(Home));

    expect(markup).toMatch(/<main\b/);
    expect(markup).toMatch(/<h1\b[^>]*>Developer workspace<\/h1>/);
    expect(markup).toContain("The app shell is ready.");
  });
});
