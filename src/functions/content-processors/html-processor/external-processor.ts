import { Readability } from "docland-readability";

import { isLocalUrl } from "../../../components/common/link";
import { throwIfNull } from "../../../libs/errors";
import type { LinkedData } from "../../../libs/jsonld-format";
import { htmlMediaType, createArticle } from "../../../libs/ld-schemas";
import { measureTime } from "../../../libs/performance";
import { documentToBlob } from "../../content-saver";
import type { ContentProcessor } from "../types";
import { getLinkedDataName } from "../utils";

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

const documentContentRoodId = "content";
const removeRootAndContentWrappers = (contentBody: HTMLElement) => {
  const newRoot = removeWrappers(
    contentBody.childNodes[0] as HTMLElement,
    contentBody
  );

  newRoot.id = documentContentRoodId;
  Array.from(newRoot.children).forEach((child) =>
    removeWrappers(child, newRoot)
  );
};

export const externalHtmlProcessor: ContentProcessor["process"] = async (
  content,
  { url, name }
) => {
  const text = await content.text();
  const domParser = new DOMParser();
  const dom = measureTime("parse", () =>
    domParser.parseFromString(text, htmlMediaType)
  );

  if (url) {
    if (isLocalUrl(url)) {
      console.log("localUrl");
    }
    const base = dom.createElement("base");
    base.href = url;
    dom.head.appendChild(base);
  }

  const article = throwIfNull(
    measureTime("readability", () =>
      new Readability(dom, { serializer: (node) => node }).parse()
    )
  );

  const articleLd: LinkedData = createArticle({
    id: url,
    name: getLinkedDataName(article.title, name),
    encodingFormat: htmlMediaType,
    urls: url ? [url] : [],
  });

  const contentDocument = document.implementation.createHTMLDocument(
    article.title
  );
  const contentBody = contentDocument.createElement("body");
  contentBody.appendChild(article.content as HTMLElement);

  contentDocument.body = contentBody;

  removeRootAndContentWrappers(contentBody);
  cleanElement(contentBody);

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
};