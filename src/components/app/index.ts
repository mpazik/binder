import "./styles.css";
import "./loading.css";

import {
  ArticleSaver,
  createArticleSaver,
} from "../../functions/article-saver";
import { createProxyFetch } from "../../functions/fetch-trough-proxy";
import { GDriveState } from "../../functions/gdrive/controller";
import { createCompositeIndexer } from "../../functions/indexes/composite-indexer";
import {
  createDirectoryIndex,
  createDirectoryIndexDb,
  createDirectoryIndexer,
  DirectoryIndex,
} from "../../functions/indexes/directory-index";
import {
  createUrlIndex,
  createUrlIndexDb,
  createUrlIndexer,
} from "../../functions/indexes/url-index";
import {
  createLinkedDataWithDocumentFetcher,
  LinkedDataWithDocumentFetcher,
} from "../../functions/linked-data-fetcher";
import { createStore, StoreState } from "../../functions/store";
import { Consumer, dataPortal, Provider } from "../../libs/connections";
import { HashName, HashUri } from "../../libs/hash";
import { measureAsyncTime } from "../../libs/performance";
import { div, slot } from "../../libs/simple-ui/render";
import { articleComponent } from "../article";
import { asyncLoader } from "../common/async-loader";
import { fileNavigation } from "../navigation";
import { profilePanel } from "../profile";
import { searchBox } from "../navigation/search-box";
import { currentDocumentUriProvider } from "../../functions/url-hijack";
import { withDefaultValue } from "../../libs/connections/processors2";

const initServices = async (): Promise<{
  contentFetcher: LinkedDataWithDocumentFetcher;
  directoryIndex: DirectoryIndex;
  gdriveStateConsumer: Consumer<GDriveState>;
  storeStateProvider: Provider<StoreState>;
  articleSaver: ArticleSaver;
}> => {
  const [gdriveStateProvider, gdriveStateConsumer] = dataPortal<GDriveState>();
  const fetchTroughProxy = createProxyFetch();
  const [urlIndexDb, directoryIndexDb] = await Promise.all([
    createUrlIndexDb(),
    createDirectoryIndexDb(),
  ]);
  const urlIndex = createUrlIndex(urlIndexDb);
  const urlIndexer = createUrlIndexer(urlIndexDb);

  const directoryIndex = createDirectoryIndex(directoryIndexDb);
  const directoryIndexer = createDirectoryIndexer(directoryIndexDb);
  const indexLinkedData = createCompositeIndexer([
    urlIndexer,
    directoryIndexer,
  ]);

  const store = await createStore(indexLinkedData);
  gdriveStateProvider((state) => store.updateGdriveState(state));

  const articleSaver = createArticleSaver(
    store.writeResource,
    store.writeLinkedData
  );

  const getHash = async (uri: string): Promise<HashName | undefined> => {
    const result = await urlIndex({ url: uri });
    if (result.length > 0) {
      return result[0].hash;
    }
  };
  const contentFetcher = createLinkedDataWithDocumentFetcher(
    getHash,
    await fetchTroughProxy,
    store.readLinkedData,
    store.readResource
  );

  return {
    contentFetcher,
    directoryIndex,
    gdriveStateConsumer,
    storeStateProvider: store.storeStateProvider,
    articleSaver,
  };
};

export const App = asyncLoader(
  measureAsyncTime("init", initServices),
  ({
    contentFetcher,
    directoryIndex,
    gdriveStateConsumer,
    storeStateProvider,
    articleSaver,
  }) => (render, onClose) => {
    const [selectedItemProvider, selectItem] = dataPortal<
      HashUri | undefined
    >();

    const [uriProvider, updateUri] = dataPortal<string>();

    render(
      div(
        div(
          { id: "navigation" },
          slot(
            "profile",
            profilePanel({ gdriveStateConsumer, storeStateProvider })
          ),
          searchBox((url) => updateUri(url.toString())),
          slot(
            "content-nav",
            fileNavigation({
              directoryIndex,
              selectedItemProvider,
            })
          )
        ),
        div(
          { id: "container" },
          div(
            { class: "p-4" },
            slot(
              "content",
              articleComponent({
                contentFetcher,
                articleSaver,
                uriProvider,
                onArticleLoaded: (linkedData) =>
                  selectItem(linkedData["@id"] as HashUri),
              })
            )
          )
        )
      )
    );

    currentDocumentUriProvider(
      onClose,
      withDefaultValue(
        "https://pl.wikipedia.org/wiki/Dedal_z_Sykionu" as string,
        updateUri
      )
    );
  }
);