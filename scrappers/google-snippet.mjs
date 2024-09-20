import puppeteer from "puppeteer";
import fs from "fs";
import cheerio from "cheerio";

function chunkArray(array, chunkSize) {
  const results = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    results.push(array.slice(i, i + chunkSize));
  }
  return results;
}

function cleanText(input) {
  const datePattern = /^\s*\d{1,2} \w{3} \d{4} — \d{1,2} \w{3} \d{4}\s*/;

  let cleanedInput = input.replace(datePattern, "").trim();

  if (cleanedInput.endsWith("...")) {
    cleanedInput = cleanedInput.slice(0, -3).trim();
  }

  return cleanedInput;
}

async function googleScrapper(queries, batchSize = 5) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 800, height: 3800 },
  });

  const queryBatches = chunkArray(queries, batchSize);
  const allResults = [];

  for (const batch of queryBatches) {
    const scrapingPromises = batch.map(async (searchTerm) => {
      const page = await browser.newPage();
      const output = [];

      try {
        await page.goto(
          `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`
        );
        await page.waitForSelector("div.N54PNb.BToiNc.cvP2Ce");

        const htmlContent = await page.content();
        const $ = cheerio.load(htmlContent);

        const results = [];

        $("div.N54PNb.BToiNc.cvP2Ce").each(async (index, element) => {
          const div = $(element);
          const header = div.find("h3.LC20lb.MBeuO.DKV0Md").text().trim();
          const snippet = div
            .find("div.VwiC3b.yXK7lf.lVm3ye.r025kc.hJNv6b span")
            .text()
            .trim();
          const link = div.find('a[jsname="UWckNb"]').attr("href");

          results.push({ header, snippet: cleanText(snippet), link });
        });

        output.push({
          query: searchTerm,
          results: results,
        });
      } catch (error) {
        console.error(`Error during scraping for '${searchTerm}':`, error);
      } finally {
        await page.close();
      }

      return output;
    });

    try {
      const batchResults = await Promise.all(scrapingPromises);
      allResults.push(...batchResults.flat());
    } catch (error) {
      console.error("Error during batch scraping:", error);
    }
  }

  try {
    fs.writeFileSync(
      "./output-snippets-google.json",
      JSON.stringify(allResults)
    );
  } catch (error) {
    console.error("Error during saving results:", error);
  } finally {
    await browser.close();
  }
}

const moreQueries = [
  "Detailed analysis of the history of artificial intelligence",
  "Investigating the ethical implications of gene editing technologies",
  "Research on the effects of climate change on global weather patterns",
  "Origins of the universe explained through the Big Bang theory",
  "Comparison between the core beliefs of major world religions",
  "Tracing the evolution of modern democracy from ancient times",
  "Impact of social media platforms on the mental health of teenagers",
  "Latest advancements in renewable energy technology and their applications",
  "Role and status of women in ancient civilizations across different cultures",
  "Future possibilities in space exploration and human colonization of Mars",
  "Comprehensive history and development of quantum computing",
  "Cultural significance and preservation of traditional music around the world",
  "Influence of the Renaissance period on contemporary art and scientific thought",
  "In-depth analysis of global economic inequality and its causes",
  "Environmental and ecological impact of plastic pollution in oceans",
  "Philosophical perspectives and theories on the meaning of human life",
  "Technological advancements in medical diagnostics and imaging",
  "Historical significance and trade impact of the Silk Road",
  "Effects of globalization on the preservation of local cultures",
  "Comparative study of education systems in ancient and modern societies",
];

googleScrapper(moreQueries);
