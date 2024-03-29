import type { Callback } from "linki";
import {
  asyncMap,
  defined,
  definedTuple,
  filter,
  fork,
  link,
  map,
  passOnlyChanged,
  pick,
  pipe,
  split,
  to,
  withErrorLogging,
} from "linki";
import type { JsonHtml, UiComponent, View } from "linki-ui";
import { div, mountComponent } from "linki-ui";

import type {
  AnalyticsSender,
  UpdateAnalyticsRepoAccount,
} from "../../functions/analytics";
import {
  createErrorSender,
  initConfiguredAnalyticsForRepoAccount,
} from "../../functions/analytics";
import { createAppContext } from "../../functions/app-context";
import type { SavedLinkedDataWithContent } from "../../functions/content-processors";
import { processFileToContent } from "../../functions/content-processors";
import { createContentSaver } from "../../functions/content-saver";
import type { Fetch } from "../../functions/fetch-trough-proxy";
import { createProxyFetch } from "../../functions/fetch-trough-proxy";
import { createGDrive } from "../../functions/gdrive";
import { gdriveUserToAccount } from "../../functions/gdrive/auth";
import type { GDriveState } from "../../functions/gdrive/controller";
import { gdrive } from "../../functions/gdrive/controller";
import type { DriverAccount, GlobalDb } from "../../functions/global-db";
import { getLastLogin, openGlobalDb } from "../../functions/global-db";
import { createAnnotationsIndex } from "../../functions/indexes/annotations-index";
import { createCompletionIndex } from "../../functions/indexes/completion-index";
import { createCompositeIndexer } from "../../functions/indexes/composite-indexer";
import { createDirectoryIndex } from "../../functions/indexes/directory-index";
import { createHabitIndex } from "../../functions/indexes/habit-index";
import type { SettingsRecord } from "../../functions/indexes/settings-index";
import {
  createSettingsIndexer,
  createSettingsStore,
  createSettingsSubscription,
  settingsStoreName,
} from "../../functions/indexes/settings-index";
import { createUriIndex } from "../../functions/indexes/url-index";
import {
  createWatchHistoryIndex,
  createWatchHistoryIndexer,
  createWatchHistorySearch,
  createWatchHistoryStore,
} from "../../functions/indexes/watch-history-index";
import { createLinkedDataWithDocumentFetcher } from "../../functions/linked-data-fetcher";
import type {
  RemoteDrive,
  RemoteDriverState,
} from "../../functions/remote-drive";
import type { StoreState } from "../../functions/store";
import { createStore } from "../../functions/store";
import type {
  RepositoryDb,
  UnclaimedRepositoryDb,
} from "../../functions/store/repository";
import {
  openAccountRepository,
  openUnclaimedRepository,
} from "../../functions/store/repository";
import { linkHijack } from "../../functions/url-hijack";
import type { Uri } from "../../libs/browser-providers";
import {
  browserUriProvider,
  currentUri,
  updateBrowserUri,
} from "../../libs/browser-providers";
import { getTodayUri } from "../../libs/calendar-ld";
import type { HashName } from "../../libs/hash";
import { storeGetAll } from "../../libs/indexeddb";
import type { LinkedData } from "../../libs/jsonld-format";
import { getType } from "../../libs/linked-data";
import { combine } from "../../libs/linki";
import {
  filterState,
  filterStates,
  handleState,
  newStateMapper,
} from "../../libs/named-state";
import type { Settings } from "../../vocabulary/setting-update";
import { createSettingUpdateAction } from "../../vocabulary/setting-update";
import { dropdown } from "../common/drop-down";
import { loader } from "../common/loader";

import { accountPicker } from "./account-picker";
import { updateDisplaySettings } from "./display-settings";
import {
  settingsIcon,
  setupDisplaySettingsPanel,
} from "./display-settings/panel";
import { fileDrop } from "./file-drop";
import { navigation } from "./navigation";
import type { PageControls } from "./page";
import { createPageView } from "./page-picker";
import { specialDirectoryUri, specialTodayUri } from "./special-uris";

type InitServices = {
  fetchTroughProxy: Fetch;
  globalDb: GlobalDb;
  unclaimedRepository: UnclaimedRepositoryDb;
  lastLogin: DriverAccount | undefined;
  initRepo: RepositoryDb;
  initialSettings: SettingsRecord[];
  sendAnalytics: AnalyticsSender;
  updateAnalyticsRepoAccount: UpdateAnalyticsRepoAccount;
};

export const initialiseServices = async (): Promise<InitServices> => {
  const [globalDb, fetchTroughProxy, unclaimedRepository] = await Promise.all([
    openGlobalDb(),
    createProxyFetch(),
    openUnclaimedRepository(),
  ]);
  const lastLogin = await getLastLogin(globalDb);
  const lastLoginRepo = lastLogin
    ? await openAccountRepository(lastLogin)
    : undefined;

  const initRepo = lastLoginRepo ?? unclaimedRepository;
  const initialSettings = await storeGetAll<SettingsRecord>(
    initRepo.getStoreProvider(settingsStoreName)
  );
  const [
    sendAnalytics,
    updateAnalyticsRepoAccount,
  ] = await initConfiguredAnalyticsForRepoAccount(lastLogin);

  return {
    fetchTroughProxy,
    globalDb,
    unclaimedRepository,
    lastLogin,
    initRepo,
    initialSettings,
    sendAnalytics,
    updateAnalyticsRepoAccount,
  };
};

const containerView: View<{
  navigationSlot: JsonHtml;
  contentSlot: JsonHtml;
  accountPickerSlot: JsonHtml;
  fileDropSlot: JsonHtml;
  onDragEnter: (event: DragEvent) => void;
}> = ({
  navigationSlot,
  contentSlot,
  accountPickerSlot,
  fileDropSlot,
  onDragEnter,
}) =>
  div(
    navigationSlot,
    div(
      {
        id: "container",
        style: {
          margin: "0 auto",
          minHeight: "100%",
        },
        onDragEnter,
      },
      fileDropSlot,
      accountPickerSlot,
      div(
        { class: "with-line-length-settings position-relative px-2 mb-4 mt-2" },
        contentSlot
      )
    )
  );

export const App = ({
  fetchTroughProxy,
  globalDb,
  unclaimedRepository,
  lastLogin,
  initRepo,
  initialSettings,
  sendAnalytics,
  updateAnalyticsRepoAccount,
  initialContent,
}: InitServices & {
  initialContent?: LinkedData;
}): UiComponent => ({ render }) => {
  const urlIndex = createUriIndex();
  const directoryIndex = createDirectoryIndex();
  const annotationsIndex = createAnnotationsIndex();
  const completionIndex = createCompletionIndex();
  const habitsIndex = createHabitIndex();
  const [
    watchHistoryStore,
    switchRepoForWatchHistory,
  ] = createWatchHistoryStore();
  const watchHistoryIndex = createWatchHistoryIndex(watchHistoryStore);
  const searchWatchHistory = createWatchHistorySearch(watchHistoryStore);

  const [settingsStore, switchRepoForSettings] = createSettingsStore();
  const [
    displaySettings,
    updateSettings,
    subscribeToSettings,
  ] = createSettingsSubscription(initialSettings);

  const indexLinkedData = createCompositeIndexer([
    urlIndex.update,
    directoryIndex.update,
    annotationsIndex.update((it) => store.readLinkedData(it)),
    createWatchHistoryIndexer(watchHistoryStore, (hash) =>
      store.removeLinkedData(hash)
    ),
    createSettingsIndexer(
      settingsStore,
      (hash) => store.removeLinkedData(hash),
      updateSettings
    ),
    completionIndex.update,
    habitsIndex.update,
  ]);
  const store = createStore(
    indexLinkedData,
    fork(
      (state) => console.log("store - ", state),
      (s) => updateStoreState(s),
      (s) => storeStateForAccountPicker(s)
    ),
    unclaimedRepository,
    sendAnalytics
  );
  const updateRepo = fork(
    () => console.log("switching repo"),
    store.switchRepo,
    urlIndex.switchRepo,
    directoryIndex.switchRepo,
    annotationsIndex.switchRepo,
    switchRepoForWatchHistory,
    switchRepoForSettings,
    completionIndex.switchRepo,
    habitsIndex.switchRepo
  );
  updateRepo(initRepo);
  const sendError = createErrorSender(sendAnalytics);

  const [gdriveStateForAccountPicker, storeStateForAccountPicker] = link(
    combine<[GDriveState | undefined, StoreState | undefined]>(
      undefined,
      undefined
    ),
    filter(definedTuple),
    ([gdriveState, storeState]) =>
      handleState<GDriveState>(gdriveState, {
        loggingIn: () => displayAccountPicker({ loading: true }),
        logged: () => closeAccountPicker(),
        signedOut: () => {
          handleState<StoreState>(storeState, {
            remoteDriveNeeded: () => displayAccountPicker({ loading: false }),
          });
        },
      })
  );

  const { provider: contextProvider, setter: setContext } = createAppContext();

  const saveLinkedData = (ld: LinkedData) =>
    store
      .writeLinkedData(ld)
      .catch((error) => console.error("Filed saving lined data", error));

  const pageControls: PageControls = {
    readAppContext: contextProvider,
    saveLinkedData: saveLinkedData,
    saveLinkedDataManually: store.writeLinkedData,
    readLinkedData: store.readLinkedData,
    readAllLinkedData: store.readAllLinkedData,
    saveResource: store.writeResource,
    readResource: store.readResource,
    search: {
      directory: directoryIndex.search,
      watchHistory: searchWatchHistory,
      watchHistoryIndex,
      completable: completionIndex.searchIndex,
    },
    subscribe: {
      annotations: annotationsIndex.subscribe(store.readLinkedData),
      completable: completionIndex.subscribe(store.readLinkedData),
      habits: habitsIndex.subscribe(store.readLinkedData),
    },
  };
  const setUser = (user: string) => setContext({ user });

  const updateGdrive = gdrive(
    fork(
      (state) => console.log("gdrive - ", state),
      (s) => updateGdriveState(s),
      link(
        filterStates("logged", "disconnected"),
        map(pick("user")),
        filter(defined),
        fork(
          (user) => console.log("switching user", user),
          link(map(pick("emailAddress")), setUser),
          link(map(gdriveUserToAccount), updateAnalyticsRepoAccount)
        )
      ),
      link(
        filterState("signedOut"),
        fork(
          () => console.log("signing out user"),
          link(map(to(null)), setUser),
          link(map(to(undefined)), updateAnalyticsRepoAccount)
        )
      ),
      link(
        map(
          newStateMapper<GDriveState, RemoteDriverState>(["off"], {
            loggingIn: () => ["loading"],
            profileRetrieving: () => ["loading"],
            logged: ({ config }) => {
              return ["on", createGDrive(config) as RemoteDrive];
            },
          })
        ),
        store.updateRemoteDriveState
      ),
      link(
        filterStates("disconnected", "signedOut"),
        map(pick("repository")),
        filter(defined),
        passOnlyChanged<RepositoryDb>(initRepo),
        fork(updateRepo, () => updateBrowserUri(specialDirectoryUri))
      ),
      link(
        filterState("loadingError"),
        map((state) => ({
          key: "gdrive-loading-error",
          message: state.error,
        })),
        sendError
      ),
      link(
        filterState("loggingInError"),
        map((state) => ({
          key: "gdrive-logging-error",
          message: state.error,
        })),
        sendError
      ),
      (it) => gdriveStateForAccountPicker(it)
    ),
    globalDb,
    unclaimedRepository
  );

  const createDisplaySettingUpdater = <T extends keyof Settings>(
    key: T
  ): ((value: Settings[T]) => void) =>
    link(
      map((it: Settings[T]) => createSettingUpdateAction(key, it)),
      saveLinkedData
    );

  const handledBySystem =
    !initialContent || getType(initialContent) != "AboutPage";

  const [
    navigationSlot,
    { updateStoreState, updateGdriveState, setCurrentUri },
  ] = mountComponent(
    navigation({
      displayed: handledBySystem,
      initProfile: {
        repository: initRepo,
        user: lastLogin
          ? {
              emailAddress: lastLogin.email,
              displayName: lastLogin.name,
            }
          : undefined,
      },
      searchDirectory: directoryIndex.search,
      searchWatchHistory,
      displaySettingsSlot: dropdown({
        icon: settingsIcon,
        title: "display settings",
        children: [
          setupDisplaySettingsPanel({
            onFontFaceChange: createDisplaySettingUpdater("fontFace"),
            onFontSizeChange: createDisplaySettingUpdater("fontSize"),
            onLineLengthChange: createDisplaySettingUpdater("lineLength"),
            onLineHeightChange: createDisplaySettingUpdater("lineHeight"),
            onThemeChange: createDisplaySettingUpdater("theme"),
          })(displaySettings),
        ],
      }),
    }),
    {
      updateGdrive,
      upload: store.upload,
      displayAccountPicker: () => displayAccountPicker({ loading: false }),
    }
  );

  const contentFetcher = createLinkedDataWithDocumentFetcher(
    async (uri: string): Promise<HashName | undefined> => {
      const result = await urlIndex.search({ url: uri });
      if (result.length > 0) {
        return result[0].hash;
      }
    },
    fetchTroughProxy,
    store.readLinkedData,
    store.readResource,
    createContentSaver(store.writeResource, store.writeLinkedData)
  );

  const [
    contentLoaderSlot,
    { load: loadResource, display: displayFile },
  ] = mountComponent(
    loader<Uri, LinkedData>({
      fetcher: contentFetcher,
      contentView: createPageView({ controls: pageControls }),
    })
  );

  const [fileDropSlot, { handleDragEvent }] = mountComponent(fileDrop, {
    onFile: link(
      withErrorLogging(asyncMap(processFileToContent)),
      withErrorLogging(
        asyncMap(createContentSaver(store.writeResource, store.writeLinkedData))
      ),
      fork<SavedLinkedDataWithContent>(
        link(map(pipe(pick("linkedData"), pick("@id"))), updateBrowserUri),
        displayFile
      )
    ),
  });

  const [
    accountPickerSlot,
    { displayAccountPicker, closeAccountPicker },
  ] = mountComponent(accountPicker, {
    gdriveLogin: () => updateGdrive(["login"]),
  });

  const renderContainer: Callback = link(
    map(
      to(() =>
        handledBySystem
          ? containerView({
              navigationSlot,
              contentSlot: contentLoaderSlot,
              fileDropSlot,
              accountPickerSlot,
              onDragEnter: handleDragEvent,
            })
          : contentLoaderSlot
      )
    ),
    render
  );

  const openPath = link(
    split<Uri>((uri) => uri === specialTodayUri),
    [
      link(map(to(() => getTodayUri())), updateBrowserUri),
      link(
        passOnlyChanged(),
        fork<Uri>(
          (it) => setCurrentUri(it),
          (it) => loadResource(it)
        )
      ),
    ]
  );

  return {
    start: () => {
      subscribeToSettings(updateDisplaySettings);
      renderContainer();
      if (initialContent) {
        displayFile(initialContent);
      } else {
        openPath(currentUri());
      }
    },
    stop: fork(
      link(browserUriProvider, openPath),
      link(linkHijack(), updateBrowserUri)
    ),
  };
};
