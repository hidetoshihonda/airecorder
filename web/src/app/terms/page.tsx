"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TermsPage() {
  const t = useTranslations("TermsPage");

  const article2Items: string[] = t.raw("article2Items");
  const article3Items: string[] = t.raw("article3Items");
  const article4Items: string[] = t.raw("article4Items");
  const article6Items: string[] = t.raw("article6Items");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToTop")}
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-gray max-w-none">
          <p className="text-sm text-gray-500 mb-6">{t("lastUpdated")}</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article1Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("article1Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article2Title")}</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t("article2Content")}
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              {article2Items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article3Title")}</h2>
            <ol className="list-decimal list-inside text-gray-700 space-y-2">
              {article3Items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article4Title")}</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t("article4Content")}
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              {article4Items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article5Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("article5Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article6Title")}</h2>
            <ol className="list-decimal list-inside text-gray-700 space-y-2">
              {article6Items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article7Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("article7Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article8Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("article8Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("article9Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("article9Content")}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">{t("article10Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("article10Content")}
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
