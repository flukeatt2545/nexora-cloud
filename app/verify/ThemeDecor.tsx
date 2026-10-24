import type { SiteThemeId } from "../siteThemes";
import { Ghost, Spider, Web } from "./Halloween";
import "./verify.themes.css";

// What each site theme adds to the verify card itself (the scene behind the page is SiteScene's):
// cobwebs and a spider for Halloween. The lettering and colours are in verify.themes.css and
// verify.halloween.css.

export const THEME_TAG: Record<string, string> = {
  halloween: "TRICK OR VERIFY",
};

/** The picture in the middle of the ring when the member has no Discord picture of their own. */
export function ThemeBadgeIcon({ theme }: { theme: SiteThemeId }) {
  if (theme === "halloween") return <Ghost className="hw-ghost-core" />;
  return null;
}

export function PanelDecor({ theme }: { theme: SiteThemeId }) {
  if (theme === "halloween") {
    return (
      <>
        <Web className="hw-web-a" />
        <Web className="hw-web-b" />
        <Spider />
      </>
    );
  }
  return null;
}
