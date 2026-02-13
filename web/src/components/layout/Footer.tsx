"use client";

import Link from "next/link";
import { Mic, Github, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

export function Footer() {
  const currentYear = new Date().getFullYear();
  const t = useTranslations("Footer");
  const tc = useTranslations("Common");

  return (
    <footer className="border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          {/* Logo and Copyright */}
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-600">
              <Mic className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              © {currentYear} AI Voice Recorder. All rights reserved.
            </span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6">
            <Link
              href="/privacy"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-white"
            >
              {t("privacyPolicy")}
            </Link>
            <Link
              href="/terms"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-white"
            >
              {t("termsOfService")}
            </Link>
            <a
              href="https://github.com/hidetoshihonda/airecorder"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition-colors dark:text-gray-400 dark:hover:text-white"
            >
              <Github className="h-4 w-4" />
              GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Tech Stack */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>{tc("poweredBy")}</span>
          <span className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">Azure Speech Services</span>
          <span className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">Azure Translator</span>
          <span className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">Azure OpenAI</span>
          <span className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">Next.js</span>
        </div>
      </div>
    </footer>
  );
}
