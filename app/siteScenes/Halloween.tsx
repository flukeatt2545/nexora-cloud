import { HalloweenBack, HalloweenBats, HalloweenDefs } from "../verify/Halloween";

// The Halloween theme reuses the village from the verify page: the same moon, house, tree and pumpkins.

export function Back() {
  return (
    <>
      <HalloweenDefs />
      <HalloweenBack />
    </>
  );
}

export function Front() {
  return <HalloweenBats />;
}
