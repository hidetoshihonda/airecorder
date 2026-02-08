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
            πâêπââπâùπü½µê╗πéï
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            σê⌐τö¿ΦªÅτ┤ä
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-gray max-w-none">
          <p className="text-sm text-gray-500 mb-6">µ£Çτ╡éµ¢┤µû░µùÑ: 2026σ╣┤2µ£ê6µùÑ</p>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼1µ¥í∩╝êΘü⌐τö¿∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed">
              µ£¼ΦªÅτ┤äπü»πÇüAI Voice Recorder∩╝êΣ╗ÑΣ╕ïπÇîµ£¼πé╡πâ╝πâôπé╣πÇì∩╝ëπü«σê⌐τö¿πü½ΘûóπüÖπéïµ¥íΣ╗╢πéÆσ«Üπéüπéïπééπü«πüºπüÖπÇé
              πâªπâ╝πé╢πâ╝πü«τÜåµºÿπü½πü»πÇüµ£¼ΦªÅτ┤äπü½σÉîµäÅπüäπüƒπüáπüäπüƒΣ╕èπüºπÇüµ£¼πé╡πâ╝πâôπé╣πéÆπüöσê⌐τö¿πüäπüƒπüáπüìπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼2µ¥í∩╝êπé╡πâ╝πâôπé╣πü«σåàσ«╣∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              µ£¼πé╡πâ╝πâôπé╣πü»πÇüΣ╗ÑΣ╕ïπü«µ⌐ƒΦâ╜πéÆµÅÉΣ╛¢πüùπü╛πüÖ∩╝Ü
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>Θƒ│σú░Θî▓Θƒ│µ⌐ƒΦâ╜</li>
              <li>πâ¬πéóπâ½πé┐πéñπâáΘƒ│σú░µûçσ¡ùΦ╡╖πüôπüùµ⌐ƒΦâ╜</li>
              <li>σñÜΦ¿ÇΦ¬₧τ┐╗Φ¿│µ⌐ƒΦâ╜</li>
              <li>AIΦ¡░Σ║ïΘî▓τöƒµêÉµ⌐ƒΦâ╜</li>
              <li>Θî▓Θƒ│σ▒Ñµ¡┤πü«τ«íτÉåµ⌐ƒΦâ╜</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼3µ¥í∩╝êσê⌐τö¿µ¥íΣ╗╢∩╝ë</h2>
            <ol className="list-decimal list-inside text-gray-700 space-y-2">
              <li>µ£¼πé╡πâ╝πâôπé╣πü»πÇüπâ₧πéñπé»µ⌐ƒΦâ╜πéÆµîüπüñπâçπâÉπéñπé╣πüºπüöσê⌐τö¿πüäπüƒπüáπüæπü╛πüÖπÇé</li>
              <li>µ£¼πé╡πâ╝πâôπé╣πü«σê⌐τö¿πü½πü»πÇüπéñπâ│πé┐πâ╝πâìπââπâêµÄÑτ╢Üπüîσ┐àΦªüπüºπüÖπÇé</li>
              <li>Azure Speech Servicesπüèπéêπü│Translatorπü«APIπé¡πâ╝πü«Φ¿¡σ«Üπüîσ┐àΦªüπüºπüÖπÇé</li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼4µ¥í∩╝êτªüµ¡óΣ║ïΘáà∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              πâªπâ╝πé╢πâ╝πü»πÇüµ£¼πé╡πâ╝πâôπé╣πü«σê⌐τö¿πü½πüéπüƒπéèπÇüΣ╗ÑΣ╕ïπü«Φíîτé║πéÆΦíîπüúπüªπü»πü¬πéèπü╛πü¢πéô∩╝Ü
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2">
              <li>µ│òΣ╗ñπü╛πüƒπü»σà¼σ║ÅΦë»Σ┐ùπü½ΘüòσÅìπüÖπéïΦíîτé║</li>
              <li>τ¼¼Σ╕ëΦÇàπü«µ¿⌐σê⌐πéÆΣ╛╡σ«│πüÖπéïΦíîτé║</li>
              <li>µ£¼πé╡πâ╝πâôπé╣πü«Θüïσû╢πéÆσª¿σ«│πüÖπéïΦíîτé║</li>
              <li>Σ╕ìµ¡úπéóπé»πé╗πé╣πéäπâÅπââπé¡πâ│πé░Φíîτé║</li>
              <li>µ£¼πé╡πâ╝πâôπé╣πéÆσòåµÑ¡τ¢«τÜäπüºτäíµû¡Σ╜┐τö¿πüÖπéïΦíîτé║</li>
              <li>Σ╗ûπü«πâªπâ╝πé╢πâ╝πü«σÇïΣ║║µâàσá▒πéÆΣ╕ìµ¡úπü½σÅÄΘ¢åπüÖπéïΦíîτé║</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼5µ¥í∩╝êτƒÑτÜäΦ▓íτöúµ¿⌐∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed">
              µ£¼πé╡πâ╝πâôπé╣πü½ΘûóπüÖπéïτƒÑτÜäΦ▓íτöúµ¿⌐πü»πÇüΘûïτÖ║ΦÇàπü╛πüƒπü»µ¡úσ╜ôπü¬µ¿⌐σê⌐ΦÇàπü½σ╕░σ▒₧πüùπü╛πüÖπÇé
              πâªπâ╝πé╢πâ╝πüîµ£¼πé╡πâ╝πâôπé╣πéÆΘÇÜπüÿπüªΣ╜£µêÉπüùπüƒπé│πâ│πâåπâ│πâä∩╝êΘî▓Θƒ│πÇüµûçσ¡ùΦ╡╖πüôπüùπâåπé¡πé╣πâêτ¡ë∩╝ëπü«
              µ¿⌐σê⌐πü»πÇüπâªπâ╝πé╢πâ╝πü½σ╕░σ▒₧πüùπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼6µ¥í∩╝êσàìΦ▓¼Σ║ïΘáà∩╝ë</h2>
            <ol className="list-decimal list-inside text-gray-700 space-y-2">
              <li>µ£¼πé╡πâ╝πâôπé╣πü»πÇîτÅ╛τè╢µ£ëσº┐πÇìπüºµÅÉΣ╛¢πüòπéîπÇüµÿÄτñ║πü╛πüƒπü»Θ╗Öτñ║πü«Σ┐¥Φ¿╝πü»πüéπéèπü╛πü¢πéôπÇé</li>
              <li>Θƒ│σú░Φ¬ìΦ¡ÿπüèπéêπü│τ┐╗Φ¿│πü«τ▓╛σ║ªπü»100%πéÆΣ┐¥Φ¿╝πüÖπéïπééπü«πüºπü»πüéπéèπü╛πü¢πéôπÇé</li>
              <li>µ£¼πé╡πâ╝πâôπé╣πü«σê⌐τö¿πü½πéêπéèτöƒπüÿπüƒµÉìσ«│πü½πüñπüäπüªπÇüΘûïτÖ║ΦÇàπü»Φ▓¼Σ╗╗πéÆΦ▓áπüäπü╛πü¢πéôπÇé</li>
              <li>πé╡πâ╝πâôπé╣πü«Σ╕¡µû¡πÇüσñëµ¢┤πÇüτ╡éΣ║åπü½πéêπéèτöƒπüÿπüƒµÉìσ«│πü½πüñπüäπüªπÇüΘûïτÖ║ΦÇàπü»Φ▓¼Σ╗╗πéÆΦ▓áπüäπü╛πü¢πéôπÇé</li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼7µ¥í∩╝êπé╡πâ╝πâôπé╣πü«σñëµ¢┤πâ╗τ╡éΣ║å∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed">
              ΘûïτÖ║ΦÇàπü»πÇüΣ║ïσëìπü«ΘÇÜτƒÑπü¬πüÅπÇüµ£¼πé╡πâ╝πâôπé╣πü«σåàσ«╣πéÆσñëµ¢┤πüùπÇüπü╛πüƒπü»µÅÉΣ╛¢πéÆτ╡éΣ║åπüÖπéïπüôπü¿πüîπüºπüìπü╛πüÖπÇé
              πüôπéîπü½πéêπéèπâªπâ╝πé╢πâ╝πü½τöƒπüÿπüƒµÉìσ«│πü½πüñπüäπüªπÇüΘûïτÖ║ΦÇàπü»Φ▓¼Σ╗╗πéÆΦ▓áπüäπü╛πü¢πéôπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼8µ¥í∩╝êσê⌐τö¿µûÖΘçæ∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed">
              µ£¼πé╡πâ╝πâôπé╣πü»τÅ╛σ£¿τäíµûÖπüºµÅÉΣ╛¢πüòπéîπüªπüäπü╛πüÖπÇé
              πüƒπüáπüùπÇüAzureσÉäπé╡πâ╝πâôπé╣πü«σê⌐τö¿µûÖΘçæπü»πÇüπâªπâ╝πé╢πâ╝Φç¬Φ║½πü«Azureπéóπé½πéªπâ│πâêπü½Φ¬▓Θçæπüòπéîπü╛πüÖπÇé
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">τ¼¼9µ¥í∩╝êΦªÅτ┤äπü«σñëµ¢┤∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed">
              ΘûïτÖ║ΦÇàπü»πÇüσ┐àΦªüπü½σ┐£πüÿπüªµ£¼ΦªÅτ┤äπéÆσñëµ¢┤πüÖπéïπüôπü¿πüîπüºπüìπü╛πüÖπÇé
              σñëµ¢┤σ╛îπü«ΦªÅτ┤äπü»πÇüµ£¼πé╡πâ╝πâôπé╣Σ╕èπü½µÄ▓Φ╝ëπüùπüƒµÖéτé╣πüºσè╣σè¢πéÆτöƒπüÿπü╛πüÖπÇé
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">τ¼¼10µ¥í∩╝êµ║ûµïáµ│òπâ╗τ«íΦ╜ä∩╝ë</h2>
            <p className="text-gray-700 leading-relaxed">
              µ£¼ΦªÅτ┤äπü«ΦºúΘçêπüèπéêπü│Θü⌐τö¿πü»πÇüµùÑµ£¼µ│òπü½µ║ûµïáπüùπü╛πüÖπÇé
              µ£¼πé╡πâ╝πâôπé╣πü½ΘûóπüÖπéïτ┤¢Σ║ëπü½πüñπüäπüªπü»πÇüµ¥▒Σ║¼σ£░µû╣ΦúüσêñµëÇπéÆτ¼¼Σ╕Çσ»⌐πü«σ░éσ▒₧τÜäσÉêµäÅτ«íΦ╜äΦúüσêñµëÇπü¿πüùπü╛πüÖπÇé
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
