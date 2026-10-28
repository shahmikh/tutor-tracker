import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Router-backed "page": /students -> "students", / -> "dashboard".
// Gives every section its own URL so the browser back/forward buttons,
// refresh and deep links all work.
export default function usePage(valid: string[]): [string, (id: string) => void] {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const seg = pathname.split("/").filter(Boolean)[0];
  const page = seg && valid.includes(seg) ? seg : "dashboard";

  const setPage = useCallback((id: string) => {
    navigate(id === "dashboard" ? "/" : `/${id}`);
  }, [navigate]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const label = page === "dashboard" ? "Dashboard" : page.charAt(0).toUpperCase() + page.slice(1);
    document.title = `${label} · Shahmikh Classroom`;
  }, [page]);

  return [page, setPage];
}
