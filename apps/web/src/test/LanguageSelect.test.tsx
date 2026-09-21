import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageSelect } from "../components/LanguageSelect";
import { initI18n } from "../i18n";

test("choosing Hebrew flips document direction to rtl", async () => {
  initI18n("en");
  render(<LanguageSelect />);
  await userEvent.selectOptions(screen.getByRole("combobox"), "he");
  expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  expect(screen.getByRole("combobox")).toHaveValue("he");
});
