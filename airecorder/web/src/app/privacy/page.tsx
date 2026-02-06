"use client";

import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPage() {
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
            <Shield className="h-6 w-6 text-blue-600" />
            プライバシーポリシー
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-gray max-w-none">
          <p className="text-sm text-gray-500 mb-6">最終更新日: 2026年2月6日</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. はじめに</h2>
            <p className="text-gray-700 leading-relaxed">
              AI Voice Recorder（以下「本サービス」）は、お客様のプライバシーを尊重し、
              個人情報の保護に努めています。本プライバシーポリシーでは、本サービスが
              どのような情報を収集し、どのように使用するかについて説明します。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. 収集する情報</h2>
            <h3 className="text-lg font-medium mb-2">2.1 音声データ</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              本サービスは、お客様が録音した音声データを処理します。
              この音声データは、文字起こしおよび翻訳のためにAzure Speech Services
              およびAzure Translatorに送信されます。
            </p>
            <h3 className="text-lg font-medium mb-2">2.2 利用データ</h3>
            <p className="text-gray-700 leading-relaxed">
              サービスの改善のため、匿名化された利用統計情報を収集する場合があります。
              これには、機能の使用頻度や一般的なエラー情報が含まれます。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. 情報の使用目的</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>音声の文字起こしサービスの提供</li>
              <li>テキストの翻訳サービスの提供</li>
              <li>議事録生成機能の提供</li>
              <li>サービスの品質向上と改善</li>
              <li>技術的な問題の診断と解決</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. データの保存と削除</h2>
            <p className="text-gray-700 leading-relaxed">
              お客様の録音データは、Azure Blob Storageに安全に保存されます。
              お客様はいつでも履歴から録音データを削除することができます。
              削除されたデータは、バックアップシステムからも30日以内に完全に削除されます。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. 第三者サービス</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              本サービスは以下のMicrosoft Azureサービスを利用しています：
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>Azure Speech Services（音声認識）</li>
              <li>Azure Translator（翻訳）</li>
              <li>Azure OpenAI Service（議事録生成）</li>
              <li>Azure Blob Storage（データ保存）</li>
              <li>Azure Cosmos DB（メタデータ管理）</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mt-4">
              これらのサービスは、Microsoftのプライバシーポリシーに従って運用されています。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. セキュリティ</h2>
            <p className="text-gray-700 leading-relaxed">
              本サービスは、お客様のデータを保護するために、業界標準のセキュリティ対策を
              講じています。すべてのデータ転送はHTTPS/TLSで暗号化され、
              保存データも暗号化されています。
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. お問い合わせ</h2>
            <p className="text-gray-700 leading-relaxed">
              本プライバシーポリシーに関するご質問やご懸念がある場合は、
              GitHubのIssueを通じてお問い合わせください。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">8. ポリシーの変更</h2>
            <p className="text-gray-700 leading-relaxed">
              本プライバシーポリシーは、必要に応じて更新されることがあります。
              重要な変更がある場合は、本サービス上で通知します。
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
