"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            トップに戻る
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            利用規約
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-gray max-w-none">
          <p className="text-sm text-gray-500 mb-6">最終更新日: 2026年2月6日</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第1条（適用）</h2>
            <p className="text-gray-700 leading-relaxed">
              本規約は、AI Voice Recorder（以下「本サービス」）の利用に関する条件を定めるものです。
              ユーザーの皆様には、本規約に同意いただいた上で、本サービスをご利用いただきます。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第2条（サービスの内容）</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              本サービスは、以下の機能を提供します：
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>音声録音機能</li>
              <li>リアルタイム音声文字起こし機能</li>
              <li>多言語翻訳機能</li>
              <li>AI議事録生成機能</li>
              <li>録音履歴の管理機能</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第3条（利用条件）</h2>
            <ol className="list-decimal list-inside text-gray-700 space-y-2">
              <li>本サービスは、マイク機能を持つデバイスでご利用いただけます。</li>
              <li>本サービスの利用には、インターネット接続が必要です。</li>
              <li>Azure Speech ServicesおよびTranslatorのAPIキーの設定が必要です。</li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第4条（禁止事項）</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              ユーザーは、本サービスの利用にあたり、以下の行為を行ってはなりません：
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>法令または公序良俗に違反する行為</li>
              <li>第三者の権利を侵害する行為</li>
              <li>本サービスの運営を妨害する行為</li>
              <li>不正アクセスやハッキング行為</li>
              <li>本サービスを商業目的で無断使用する行為</li>
              <li>他のユーザーの個人情報を不正に収集する行為</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第5条（知的財産権）</h2>
            <p className="text-gray-700 leading-relaxed">
              本サービスに関する知的財産権は、開発者または正当な権利者に帰属します。
              ユーザーが本サービスを通じて作成したコンテンツ（録音、文字起こしテキスト等）の
              権利は、ユーザーに帰属します。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第6条（免責事項）</h2>
            <ol className="list-decimal list-inside text-gray-700 space-y-2">
              <li>本サービスは「現状有姿」で提供され、明示または黙示の保証はありません。</li>
              <li>音声認識および翻訳の精度は100%を保証するものではありません。</li>
              <li>本サービスの利用により生じた損害について、開発者は責任を負いません。</li>
              <li>サービスの中断、変更、終了により生じた損害について、開発者は責任を負いません。</li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第7条（サービスの変更・終了）</h2>
            <p className="text-gray-700 leading-relaxed">
              開発者は、事前の通知なく、本サービスの内容を変更し、または提供を終了することができます。
              これによりユーザーに生じた損害について、開発者は責任を負いません。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第8条（利用料金）</h2>
            <p className="text-gray-700 leading-relaxed">
              本サービスは現在無料で提供されています。
              ただし、Azure各サービスの利用料金は、ユーザー自身のAzureアカウントに課金されます。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">第9条（規約の変更）</h2>
            <p className="text-gray-700 leading-relaxed">
              開発者は、必要に応じて本規約を変更することができます。
              変更後の規約は、本サービス上に掲載した時点で効力を生じます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">第10条（準拠法・管轄）</h2>
            <p className="text-gray-700 leading-relaxed">
              本規約の解釈および適用は、日本法に準拠します。
              本サービスに関する紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
