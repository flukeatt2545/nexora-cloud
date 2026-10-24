"use client";

import { useEffect } from "react";
import { Spider, Web } from "../verify/Halloween";
import { HalloweenEffect } from "./halloween-fx";
import { HalloweenSlimeEdges } from "./halloween-edges";
import "./halloween-slime.css";

// What the Halloween theme puts over the pages (the top layer of SiteScene): cobwebs in the two top
// corners with a spider on a thread, the canvas effects of halloween-fx.js (pumpkins and witch hats
// falling, a shockwave on click, lightning, a skeleton hand for the mouse pointer) and the slime along
// the top of the home page banner and cards (halloween-edges.js, a canvas laid inside each box so it
// scrolls with it).

export default function HalloweenSlime() {
  useEffect(() => {
    // Under the dialogs (1000 and up) and level with this layer, so a dialog is never covered by a pumpkin.
    const effect = new HalloweenEffect({ zIndex: 900 });
    const edges = new HalloweenSlimeEdges();
    return () => {
      effect.destroy();
      edges.destroy();
    };
  }, []);

  return (
    <>
      <Web className="hs-web hs-web-tl" />
      <Web className="hs-web hs-web-tr" />
      <span className="hs-spider-wrap"><Spider /></span>
    </>
  );
}
