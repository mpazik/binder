import { tool } from "@opencode-ai/plugin";

export default tool({
  description: `Web search that returns AI-generated response with citations
Use this tool when you need current information from the web or want to research topics with reliable sources`,
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
  },
  async execute(args) {
    const query = args.query;
    const API_KEY = process.env.PERPLEXITY_API_KEY;
    if (!API_KEY) {
      throw new Error(
        "Please set the PERPLEXITY_API_KEY environment variable with your API key.",
      );
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "Be precise and concise" },
          { role: "user", content: query },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Perplexity API error (${response.status}): ${await response.text()}`,
      );
    }

    const data = await response.json();
    const content =
      data.choices[0]?.message?.content || "No response generated";
    const citations =
      data.search_results
        ?.map((r: any) => `- [${r.title}](${r.url})`)
        .join("\n") || "";

    return content + (citations ? `\n\n## Sources\n${citations}` : "");
  },
});
