<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep the local FastAPI/YOLO processing service separate from the TanStack Start frontend because computer-vision native dependencies cannot run in the hosted edge runtime.
- Share live traffic state through the frontend provider and local API polling because all five views must represent the same detections, never synthetic counts.
