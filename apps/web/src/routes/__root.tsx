import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "../components/LanguageSelect";
import { Button } from "../components/ui/button";
import { auth, signInWithGoogle } from "../lib/firebase";
import { useAuth } from "../lib/useAuth";

export const Route = createRootRoute({ component: Shell });

function Shell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [signInFailed, setSignInFailed] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-4 py-3">
        <Link to="/" className="font-semibold">
          {t("app.name")}
        </Link>
        <div className="ms-auto flex items-center gap-3">
          <LanguageSelect />
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">
                {t("auth.signedInAs", { email: user.email })}
              </span>
              <Button variant="secondary" onClick={() => void signOut(auth)}>
                {t("auth.signOut")}
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => {
                  setSignInFailed(false);
                  void signInWithGoogle().catch(() => setSignInFailed(true));
                }}
              >
                {t("auth.signIn")}
              </Button>
              {signInFailed ? (
                <span className="text-sm text-destructive">{t("auth.failed")}</span>
              ) : null}
            </>
          )}
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
