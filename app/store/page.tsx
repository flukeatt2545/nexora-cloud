"use client";

import UserOrPublicShell from "../components/UserOrPublicShell";
import GamingStore from "../GamingStore";

export default function StorePage() {
  return (
    <UserOrPublicShell
      view="store"
      loadingLabel="กำลังเข้าสู่ร้านค้า..."
      publicNode={<GamingStore mode="store" />}
    />
  );
}
