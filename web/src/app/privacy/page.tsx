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
            πâêπââπâùπü½µê╗πéï
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-600" />
            πâùπâ⌐πéñπâÉπé╖πâ╝πâ¥πâ¬πé╖πâ╝
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-gray max-w-none">
          <p className="text-sm text-gray-500 mb-6">µ£Çτ╡éµ¢┤µû░µùÑ: 2026σ╣┤2µ£ê6µùÑ</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">1. πü»πüÿπéüπü½</h2>
            <p className="text-gray-700 leading-relaxed">
              AI Voice Recorder∩╝êΣ╗ÑΣ╕ïπÇîµ£¼πé╡πâ╝πâôπé╣πÇì∩╝ëπü»πÇüπüèσ«óµºÿπü«πâùπâ⌐πéñπâÉπé╖πâ╝πéÆσ░èΘçìπüùπÇü
              σÇïΣ║║µâàσá▒πü«Σ┐¥Φ¡╖πü½σè¬πéüπüªπüäπü╛πüÖπÇéµ£¼πâùπâ⌐πéñπâÉπé╖πâ╝πâ¥πâ¬πé╖πâ╝πüºπü»πÇüµ£¼πé╡πâ╝πâôπé╣πüî
              πü⌐πü«πéêπüåπü¬µâàσá▒πéÆσÅÄΘ¢åπüùπÇüπü⌐πü«πéêπüåπü½Σ╜┐τö¿πüÖπéïπüïπü½πüñπüäπüªΦ¬¼µÿÄπüùπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">2. σÅÄΘ¢åπüÖπéïµâàσá▒</h2>
            <h3 className="text-lg font-medium mb-2">2.1 Θƒ│σú░πâçπâ╝πé┐</h3>
            <p className="text-gray-700 leading-relaxed mb-4">
              µ£¼πé╡πâ╝πâôπé╣πü»πÇüπüèσ«óµºÿπüîΘî▓Θƒ│πüùπüƒΘƒ│σú░πâçπâ╝πé┐πéÆσçªτÉåπüùπü╛πüÖπÇé
              πüôπü«Θƒ│σú░πâçπâ╝πé┐πü»πÇüµûçσ¡ùΦ╡╖πüôπüùπüèπéêπü│τ┐╗Φ¿│πü«πüƒπéüπü½Azure Speech Services
              πüèπéêπü│Azure Translatorπü½ΘÇüΣ┐íπüòπéîπü╛πüÖπÇé
            </p>
            <h3 className="text-lg font-medium mb-2">2.2 σê⌐τö¿πâçπâ╝πé┐</h3>
            <p className="text-gray-700 leading-relaxed">
              πé╡πâ╝πâôπé╣πü«µö╣σûäπü«πüƒπéüπÇüσî┐σÉìσîûπüòπéîπüƒσê⌐τö¿τ╡▒Φ¿êµâàσá▒πéÆσÅÄΘ¢åπüÖπéïσá┤σÉêπüîπüéπéèπü╛πüÖπÇé
              πüôπéîπü½πü»πÇüµ⌐ƒΦâ╜πü«Σ╜┐τö¿Θá╗σ║ªπéäΣ╕ÇΦê¼τÜäπü¬πé¿πâ⌐πâ╝µâàσá▒πüîσÉ½πü╛πéîπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">3. µâàσá▒πü«Σ╜┐τö¿τ¢«τÜä</h2>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>Θƒ│σú░πü«µûçσ¡ùΦ╡╖πüôπüùπé╡πâ╝πâôπé╣πü«µÅÉΣ╛¢</li>
              <li>πâåπé¡πé╣πâêπü«τ┐╗Φ¿│πé╡πâ╝πâôπé╣πü«µÅÉΣ╛¢</li>
              <li>Φ¡░Σ║ïΘî▓τöƒµêÉµ⌐ƒΦâ╜πü«µÅÉΣ╛¢</li>
              <li>πé╡πâ╝πâôπé╣πü«σôüΦ│¬σÉæΣ╕èπü¿µö╣σûä</li>
              <li>µèÇΦíôτÜäπü¬σòÅΘíîπü«Φ¿║µû¡πü¿Φºúµ▒║</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">4. πâçπâ╝πé┐πü«Σ┐¥σ¡ÿπü¿σëèΘÖñ</h2>
            <p className="text-gray-700 leading-relaxed">
              πüèσ«óµºÿπü«Θî▓Θƒ│πâçπâ╝πé┐πü»πÇüAzure Blob Storageπü½σ«ëσà¿πü½Σ┐¥σ¡ÿπüòπéîπü╛πüÖπÇé
              πüèσ«óµºÿπü»πüäπüñπüºπééσ▒Ñµ¡┤πüïπéëΘî▓Θƒ│πâçπâ╝πé┐πéÆσëèΘÖñπüÖπéïπüôπü¿πüîπüºπüìπü╛πüÖπÇé
              σëèΘÖñπüòπéîπüƒπâçπâ╝πé┐πü»πÇüπâÉπââπé»πéóπââπâùπé╖πé╣πâåπâáπüïπéëπéé30µùÑΣ╗Ñσåàπü½σ«îσà¿πü½σëèΘÖñπüòπéîπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">5. τ¼¼Σ╕ëΦÇàπé╡πâ╝πâôπé╣</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              µ£¼πé╡πâ╝πâôπé╣πü»Σ╗ÑΣ╕ïπü«Microsoft Azureπé╡πâ╝πâôπé╣πéÆσê⌐τö¿πüùπüªπüäπü╛πüÖ∩╝Ü
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>Azure Speech Services∩╝êΘƒ│σú░Φ¬ìΦ¡ÿ∩╝ë</li>
              <li>Azure Translator∩╝êτ┐╗Φ¿│∩╝ë</li>
              <li>Azure OpenAI Service∩╝êΦ¡░Σ║ïΘî▓τöƒµêÉ∩╝ë</li>
              <li>Azure Blob Storage∩╝êπâçπâ╝πé┐Σ┐¥σ¡ÿ∩╝ë</li>
              <li>Azure Cosmos DB∩╝êπâíπé┐πâçπâ╝πé┐τ«íτÉå∩╝ë</li>
            </ul>
            <p className="text-gray-700 leading-relaxed mt-4">
              πüôπéîπéëπü«πé╡πâ╝πâôπé╣πü»πÇüMicrosoftπü«πâùπâ⌐πéñπâÉπé╖πâ╝πâ¥πâ¬πé╖πâ╝πü½σ╛ôπüúπüªΘüïτö¿πüòπéîπüªπüäπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">6. πé╗πé¡πâÑπâ¬πâåπéú</h2>
            <p className="text-gray-700 leading-relaxed">
              µ£¼πé╡πâ╝πâôπé╣πü»πÇüπüèσ«óµºÿπü«πâçπâ╝πé┐πéÆΣ┐¥Φ¡╖πüÖπéïπüƒπéüπü½πÇüµÑ¡τòîµ¿Öµ║ûπü«πé╗πé¡πâÑπâ¬πâåπéúσ»╛τ¡ûπéÆ
              Φ¼¢πüÿπüªπüäπü╛πüÖπÇéπüÖπü╣πüªπü«πâçπâ╝πé┐Φ╗óΘÇüπü»HTTPS/TLSπüºµÜùσÅ╖σîûπüòπéîπÇü
              Σ┐¥σ¡ÿπâçπâ╝πé┐πééµÜùσÅ╖σîûπüòπéîπüªπüäπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">7. πüèσòÅπüäσÉêπéÅπü¢</h2>
            <p className="text-gray-700 leading-relaxed">
              µ£¼πâùπâ⌐πéñπâÉπé╖πâ╝πâ¥πâ¬πé╖πâ╝πü½ΘûóπüÖπéïπüöΦ│¬σòÅπéäπüöµç╕σ┐╡πüîπüéπéïσá┤σÉêπü»πÇü
              GitHubπü«IssueπéÆΘÇÜπüÿπüªπüèσòÅπüäσÉêπéÅπü¢πüÅπüáπüòπüäπÇé
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">8. πâ¥πâ¬πé╖πâ╝πü«σñëµ¢┤</h2>
            <p className="text-gray-700 leading-relaxed">
              µ£¼πâùπâ⌐πéñπâÉπé╖πâ╝πâ¥πâ¬πé╖πâ╝πü»πÇüσ┐àΦªüπü½σ┐£πüÿπüªµ¢┤µû░πüòπéîπéïπüôπü¿πüîπüéπéèπü╛πüÖπÇé
              ΘçìΦªüπü¬σñëµ¢┤πüîπüéπéïσá┤σÉêπü»πÇüµ£¼πé╡πâ╝πâôπé╣Σ╕èπüºΘÇÜτƒÑπüùπü╛πüÖπÇé
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
