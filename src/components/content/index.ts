import { div, dom, mountComponent, renderJsonHtmlToDom } from "linki-ui";

import { throwIfNull } from "../../libs/errors";
import { annotationsSupport } from "../annotations";
import { contentDisplayComponent } from "../content-body";
import type { PageView } from "../pages/utils";

import { contentHeader } from "./content-header";

export const contentComponent: PageView = (controls, data) => {
  const linkedData = throwIfNull(data);
  const reference = throwIfNull(linkedData["@id"]);

  const [
    annotationSupportSlot,
    { displayDocumentAnnotations, setContainer: setAnnotationContainer },
  ] = mountComponent(annotationsSupport(controls, reference));

  const [contentSlot] = mountComponent(
    contentDisplayComponent(controls, linkedData),
    {
      onAnnotationDisplayRequest: displayDocumentAnnotations,
    }
  );

  const containerDom = renderJsonHtmlToDom(
    div(
      {
        id: "content-container",
        class: "mb-3 position-relative px-4",
      },
      contentHeader(controls, linkedData),
      div(
        {
          id: "content-body",
        },
        contentSlot
      ),
      annotationSupportSlot
    )
  ) as HTMLElement;
  setAnnotationContainer(containerDom);
  return dom(containerDom);
};
