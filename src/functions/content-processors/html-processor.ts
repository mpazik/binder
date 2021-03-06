import { Readability } from "@mozilla/readability";
import * as pdfjsLib from "pdfjs-dist";

import { throwIfNull } from "../../libs/errors";
import { LinkedData } from "../../libs/jsonld-format";
import { htmlMediaType, createArticle } from "../../libs/ld-schemas";
import { measureTime } from "../../libs/performance";
import { documentToBlob } from "../content-saver";

import { ContentProcessor } from "./types";
import { getLinkedDataName } from "./utils";

export const parseArticleContent = (body: string): Document => {
  const parser = new DOMParser();
  return parser.parseFromString(body, htmlMediaType);
};

const removeBaseUrlFromFragments = (
  contentDocument: Document,
  baseUrl: string
) => {
  const links = Array.from(contentDocument.getElementsByTagName("a"));
  links.forEach((it) => {
    const href = it.getAttribute("href");
    if (href && href.startsWith(baseUrl + "#")) {
      it.setAttribute("href", href.replace(baseUrl, ""));
    }
  });
};

const removeWrappers = (element: Element, parent: Element): Element => {
  if (element.childNodes.length === 1 && element.tagName === "DIV") {
    const childNode = element.childNodes[0];
    if (childNode.nodeType === Node.ELEMENT_NODE) {
      parent.replaceChild(childNode, element);
      return removeWrappers(childNode as Element, parent);
    }
  }
  return element;
};

const cleanElement = (node: Node) => {
  for (let n = 0; n < node.childNodes.length; n++) {
    const child = node.childNodes[n];
    if (
      child.nodeType === Node.COMMENT_NODE ||
      (child.nodeType === Node.TEXT_NODE &&
        !(child.nodeValue && /\S/.test(child.nodeValue)))
    ) {
      node.removeChild(child);
      n--;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      cleanElement(child);
    }
  }
};

export const documentContentRoodId = "content";

export const getDocumentContentRoot = (
  contentDocument: Document
): HTMLElement =>
  throwIfNull(
    contentDocument.getElementById("content"),
    () =>
      'expected that article document would have root element with id "content'
  );

const removeRootAndContentWrappers = (contentDocument: Document) => {
  const newRoot = removeWrappers(
    contentDocument.body.childNodes[0] as HTMLElement,
    contentDocument.body
  );

  newRoot.id = documentContentRoodId;
  Array.from(newRoot.children).forEach((child) =>
    removeWrappers(child, newRoot)
  );
};

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.js";

export const htmlContentProcessor: ContentProcessor = {
  mediaType: htmlMediaType,
  process: async (content, { url, name }) => {
    const text = await content.text();
    const domParser = new DOMParser();
    const dom = measureTime("parse", () =>
      domParser.parseFromString(text, htmlMediaType)
    );

    if (url) {
      const base = dom.createElement("base");
      base.href = url;
      dom.head.appendChild(base);
    }

    const article = throwIfNull(
      measureTime("readability", () => new Readability(dom).parse())
    );

    const articleLd: LinkedData = createArticle({
      id: url,
      name: getLinkedDataName(article.title, name),
      encodingFormat: htmlMediaType,
      urls: url ? [url] : [],
    });

    const contentDocument = domParser.parseFromString(
      article.content,
      htmlMediaType
    );
    removeRootAndContentWrappers(contentDocument);
    cleanElement(contentDocument.body);

    const titleEl = contentDocument.createElement("title");
    titleEl.appendChild(contentDocument.createTextNode(article.title));
    contentDocument.head.appendChild(titleEl);

    const metaEl = contentDocument.createElement("meta");
    metaEl.setAttribute("charset", "UTF-8");
    contentDocument.head.appendChild(metaEl);

    if (url) {
      const baseEl = contentDocument.createElement("base");
      baseEl.setAttribute("href", url);
      contentDocument.head.appendChild(baseEl);
      removeBaseUrlFromFragments(contentDocument, url);
    }

    return {
      content: documentToBlob(contentDocument),
      linkedData: articleLd,
    };
  },
};
