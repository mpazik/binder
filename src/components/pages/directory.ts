import { asyncMap, kick, link, map, withErrorLogging, wrap } from "linki";
import type { View } from "linki-ui";
import { a, div, h3, nav, p, small, span } from "linki-ui";

import type { RecentDocuments } from "../../functions/recent-document-serach";
import { createRecentDocumentSearch } from "../../functions/recent-document-serach";
import { combineToUri } from "../../libs/browser-providers";
import { relativeDate } from "../common/relative-date";
import type { PageControls, PageView } from "../system/page";
import { mountBlock } from "../system/page";

export const loading: View = () => span("Loading...");

const view: View<{
  docs: RecentDocuments[];
}> = ({ docs }) =>
  div(
    h3("Your documents"),
    nav(
      { class: "menu my-3" },
      ...docs.map((it) =>
        a(
          { class: "menu-item", href: combineToUri(it.uriWithFragment) },
          it.name,
          ...(it.startDate
            ? [
                small(
                  { class: "float-right" },
                  relativeDate({ date: it.startDate })
                ),
              ]
            : [])
        )
      )
    ),
    div(
      { class: "Box p-2 mb-4, p-3" },
      p(
        "Paste url of your favorite blogpost, wikipedia article or news page to the search bar on the top of the page, or drop a PDF or EBUP file into the window."
      ),
      p(a({ href: "/about" }, "learn more"))
    )
  );

export const docsDirectory: PageView = ({
  search: { directory: searchDirectory, watchHistory: searchWatchHistory },
}: PageControls) => {
  const searchRecentDocuments = createRecentDocumentSearch(
    searchDirectory,
    searchWatchHistory
  );

  return mountBlock(({ render }) => {
    render(loading());
    link(
      kick(undefined),
      withErrorLogging(asyncMap(searchRecentDocuments)),
      map(wrap("docs"), view),
      render
    );
  });
};
