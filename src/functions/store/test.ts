import type { Store } from "./index";

describe("store", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let store: Store;
  test("should require upload after writing resource", async () => {});

  test("should require upload after writing lined data", async () => {});

  test("should download all data after connecting to external store", async () => {});

  test("should upload not synchronised data after connecting to external store", async () => {});

  test("should auto upload after set time passed", async () => {
    // await store.writeLinkedData(linkedData1);
    // check that auto upload was scheduled
    // trigger auto upload
    // check that state is ready
  });

  test("should not auto upload when upload was triggered manually", async () => {
    // await store.writeLinkedData(linkedData1);
    //
    // await store.upload();
    // check that auto upload timer was canceled
    // check that state is ready
  });

  test("should not auto upload when upload was triggered manually", async () => {
    // await store.writeLinkedData(linkedData1);
    //
    // await store.upload();
    // check that auto upload timer was canceled
    // check that state is ready
  });

  test("should claim data when connecting to external drive", async () => {});
});
