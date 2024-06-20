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

function extract(data) {
  const arr = data.split("\r").join("").split("\n");

  const filteredArr = arr.filter((element) => {
    const words = element.split(" ");
    return words.length > 3;
  });

  const text = filteredArr.join(" ");

  return text.replace(/\s\s+/g, " ");
}

function splitContentIntoSentences(content) {
  return content
    .split(/[.!]\s|\n/)
    .filter((sentence) => sentence.trim().length > 0);
}

function calculateMatchPercentage(snippet, sentence) {
  const snippetWords = snippet.split(/\s+/);
  const sentenceWords = sentence.split(/\s+/);

  const matchCount = snippetWords.filter((word) =>
    sentenceWords.includes(word)
  ).length;

  return (matchCount / snippetWords.length) * 100;
}

function findBestMatchAndNeighbors(snippet, content) {
  const sentences = splitContentIntoSentences(content);
  let bestMatch = { sentence: "", percentage: 0 };
  let bestIndex = -1;

  sentences.forEach((sentence, index) => {
    const percentage = calculateMatchPercentage(snippet, sentence);
    if (percentage > bestMatch.percentage) {
      bestMatch.sentence = sentence;
      bestMatch.percentage = percentage;
      bestIndex = index;
    }
  });

  // Retrieve the sentence before and after the best match sentence
  const before = sentences[bestIndex - 1] || "";
  const after = sentences[bestIndex + 1] || "";

  // Construct the paragraph combining before, best match, and after
  const combinedParagraph = `${before} ${bestMatch.sentence} ${after}`.trim();

  return {
    bestMatch: bestMatch,
    before: before,
    after: after,
    combinedParagraph: combinedParagraph,
  };
}

function findContent(arr, query) {
  const newArr = arr.map((item) => {
    const { content, snippet, ...others } = item;
    if (content !== "Text Not Found") {
      if (snippet.trim() == "") {
        const bestMatch = findBestMatchAndNeighbors(
          query,
          content
        ).combinedParagraph;
        return {
          snippet,
          content: bestMatch,
          ...others,
        };
      }
      const bestMatch = findBestMatchAndNeighbors(
        snippet,
        content
      ).combinedParagraph;

      return {
        snippet,
        content: bestMatch,
        ...others,
      };
    } else {
      return item;
    }
  });

  return newArr;
}

async function fetchContentFromURLs(resultsArray, query) {
  try {
    const browser = await puppeteer.launch({ headless: false });
    const results = [];

    for (let i = 0; i < resultsArray.length; i += 5) {
      const batchUrls = resultsArray.slice(i, i + 5);

      const batchPromises = batchUrls.map(async (result) => {
        const { link, header, snippet } = result;
        let content = null;

        let page;

        try {
          page = await browser.newPage();
          await page.goto(link);

          const htmlContent = await page.content();
          const $ = cheerio.load(htmlContent);

          const text = $("body *:not(script)")
            .contents()
            .map(function () {
              if (this.type === "text") {
                return $(this).text().trim() + " ";
              }
              return "";
            })
            .get()
            .join(" ");

          content = extract(text);
        } catch (error) {
          console.error(`Error processing URL ${link}: ${error.message}`);
        } finally {
          if (page) await page.close();
        }

        if (content && content.trim()) {
          results.push({
            link,
            content: content.trim(),
            header,
            snippet,
          });
        } else {
          results.push({ link, content: "Text Not Found", header, snippet });
        }
      });

      await Promise.all(batchPromises);
    }

    await browser.close();

    return findContent(results, query);
  } catch (error) {
    console.error("Browser launch error:", error);
    return [];
  }
}

function cleanText(input) {
  const datePattern = /^\s*\d{1,2} \w{3} \d{4} — \d{1,2} \w{3} \d{4}\s*/;

  let cleanedInput = input.replace(datePattern, "").trim();

  if (cleanedInput.endsWith("...")) {
    cleanedInput = cleanedInput.slice(0, -3).trim();
  }

  return cleanedInput;
}

async function googleScrapper(queries, batchSize = 2) {
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
          results: await fetchContentFromURLs(results, searchTerm),
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
    fs.writeFileSync("./output-parallel.json", JSON.stringify(allResults));
  } catch (error) {
    console.error("Error during saving results:", error);
  } finally {
    await browser.close();
  }
}

const moreQueries = [
  "History of artificial intelligence",
  "Ethical implications of gene editing",
  "Effects of climate change on global weather patterns",
  "Origins of the universe according to the Big Bang theory",
  "Comparison of major world religions",
  "Evolution of modern democracy",
];

googleScrapper(moreQueries);
