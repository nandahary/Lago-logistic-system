import { useEffect, useState } from "react";
import { api } from "./api";

// Simple in-memory cache to avoid refetching outlets on every mount
let cache = null;
let inflight = null;

export function useOutlets() {
  const [outlets, setOutlets] = useState(cache || []);
  useEffect(() => {
    if (cache) return;
    if (!inflight) {
      inflight = api.get("/outlets").then((r) => {
        cache = r.data;
        return r.data;
      });
    }
    inflight.then((d) => setOutlets(d));
  }, []);
  return outlets;
}

export function invalidateOutletsCache() {
  cache = null;
  inflight = null;
}
