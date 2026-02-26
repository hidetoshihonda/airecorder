"use client";

import { useTranslations } from "next-intl";
import {
  FileText,
  Users,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  AlertCircle,
  TrendingUp,
  GitBranch,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CrossAnalysisResult as CrossAnalysisResultType } from "@/types";

interface Props {
  result: CrossAnalysisResultType;
}

const STATUS_CONFIG: Record<
  string,
  { icon: React.ReactNode; label: string; className: string }
> = {
  new: {
    icon: <Circle className="h-3.5 w-3.5" />,
    label: "statusNew",
    className: "bg-blue-100 text-blue-700",
  },
  "in-progress": {
    icon: <Clock className="h-3.5 w-3.5" />,
    label: "statusInProgress",
    className: "bg-yellow-100 text-yellow-700",
  },
  completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: "statusCompleted",
    className: "bg-green-100 text-green-700",
  },
  stalled: {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    label: "statusStalled",
    className: "bg-orange-100 text-orange-700",
  },
  dropped: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: "statusDropped",
    className: "bg-gray-100 text-gray-500",
  },
};

export function CrossAnalysisResultView({ result }: Props) {
  const t = useTranslations("CrossAnalysisPage");

  return (
    <Tabs defaultValue="summary" className="w-full">
      <TabsList className="mb-4 w-full justify-start overflow-x-auto">
        <TabsTrigger value="summary" className="flex items-center gap-1.5">
          <FileText className="h-4 w-4" />
          {t("overallSummary")}
        </TabsTrigger>
        <TabsTrigger value="actions" className="flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          {t("actionTracking")}
        </TabsTrigger>
        <TabsTrigger value="decisions" className="flex items-center gap-1.5">
          <GitBranch className="h-4 w-4" />
          {t("decisionEvolution")}
        </TabsTrigger>
        <TabsTrigger value="trends" className="flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4" />
          {t("trends")}
        </TabsTrigger>
      </TabsList>

      {/* === Overall Summary === */}
      <TabsContent value="summary" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("overallSummary")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-gray-700 leading-relaxed">
              {result.overallSummary}
            </p>
          </CardContent>
        </Card>

        {result.commonThemes.length > 0 && (
          <div>
            <h3 className="mb-3 text-lg font-semibold text-gray-900">
              {t("commonThemes")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {result.commonThemes.map((theme, i) => (
                <Card key={i} className="border-l-4 border-l-blue-500">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <h4 className="font-medium text-gray-900">
                        {theme.theme}
                      </h4>
                      <span className="ml-2 flex-shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {t("mentionedIn", { count: theme.frequency })}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {theme.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {theme.mentionedIn.map((name, j) => (
                        <span
                          key={j}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </TabsContent>

      {/* === Action Item Tracking === */}
      <TabsContent value="actions" className="space-y-4">
        {result.actionItemTracking.length > 0 ? (
          result.actionItemTracking.map((item, i) => {
            const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.new;
            return (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">{item.task}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {item.assignee}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {item.firstMentioned}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.className}`}
                    >
                      {statusCfg.icon}
                      {t(statusCfg.label)}
                    </span>
                  </div>

                  {item.history.length > 0 && (
                    <div className="mt-3 border-l-2 border-gray-200 pl-4">
                      {item.history.map((h, j) => (
                        <div key={j} className="mb-2 last:mb-0">
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span className="font-medium text-gray-600">
                              {h.recordingTitle}
                            </span>
                            <span>{h.date}</span>
                          </div>
                          <p className="text-sm text-gray-700">{h.update}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              {t("noData")}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* === Decision Evolution === */}
      <TabsContent value="decisions" className="space-y-4">
        {result.decisionEvolution.length > 0 ? (
          result.decisionEvolution.map((item, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{item.topic}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative border-l-2 border-blue-200 pl-4">
                  {item.decisions.map((d, j) => (
                    <div key={j} className="mb-4 last:mb-0">
                      <div className="absolute -left-[9px] h-4 w-4 rounded-full border-2 border-blue-500 bg-white" />
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="font-medium text-gray-600">
                          {d.recordingTitle}
                        </span>
                        <span>{d.date}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-gray-700">
                        {d.decision}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              {t("noData")}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* === Trends === */}
      <TabsContent value="trends" className="space-y-6">
        {/* Topic Frequency */}
        {Object.keys(result.trends.topicFrequency).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("topicFrequency")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(result.trends.topicFrequency)
                  .sort(([, a], [, b]) => b - a)
                  .map(([topic, count]) => {
                    const maxCount = Math.max(
                      ...Object.values(result.trends.topicFrequency)
                    );
                    const pct = (count / maxCount) * 100;
                    return (
                      <div key={topic} className="flex items-center gap-3">
                        <span className="w-32 flex-shrink-0 truncate text-sm text-gray-700">
                          {topic}
                        </span>
                        <div className="relative flex-1">
                          <div className="h-5 w-full rounded bg-gray-100" />
                          <div
                            className="absolute inset-y-0 left-0 rounded bg-blue-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-8 flex-shrink-0 text-right text-sm font-medium text-gray-700">
                          {count}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recurring Issues */}
        {result.trends.recurringIssues.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("recurringIssues")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {result.trends.recurringIssues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-500" />
                    <span className="text-gray-700">{issue}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Sentiment */}
        {result.trends.sentimentTrend && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("sentimentTrend")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700">
                {result.trends.sentimentTrend}
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}
