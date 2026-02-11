"use client";

import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPage() {
  const t = useTranslations("PrivacyPage");

  const section3Items: string[] = t.raw("section3Items");
  const section5Items: string[] = t.raw("section5Items");

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
            <Shield className="h-6 w-6 text-blue-600" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-gray max-w-none">
          <p className="text-sm text-gray-500 mb-6">{t("lastUpdated")}</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("section1Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("section1Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("section2Title")}</h2>
            <h3 className="text-lg font-medium mb-2">{t("section2_1Title")}</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t("section2_1Content")}
            </p>
            <h3 className="text-lg font-medium mb-2">{t("section2_2Title")}</h3>
            <p className="text-gray-700 leading-relaxed">
              {t("section2_2Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("section3Title")}</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              {section3Items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("section4Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("section4Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("section5Title")}</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              {t("section5Content")}
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              {section5Items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <p className="text-gray-700 leading-relaxed mt-4">
              {t("section5Footer")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("section6Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("section6Content")}
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("section7Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("section7Content")}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">{t("section8Title")}</h2>
            <p className="text-gray-700 leading-relaxed">
              {t("section8Content")}
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
