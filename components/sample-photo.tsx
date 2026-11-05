import Image from "next/image";

// ponytail: sample photos of other buildings until the client supplies its own, so each is labelled
// as a sample. RERA rules out implying that a photo shows the registered project.
const PHOTOS = [
  {
    src: "/images/project-1.jpg",
    position: "50% 42%",
    credit: "Nikhilb239, CC BY 3.0, cropped",
    url: "https://commons.wikimedia.org/wiki/File:Residential_Building,_Hyderabad,_20022015.jpg",
  },
  {
    src: "/images/project-2.jpg",
    position: "50% 55%",
    credit: "Sanfy, CC BY-SA 4.0, cropped",
    url: "https://commons.wikimedia.org/wiki/File:Tower_blocks_in_Mira_Road.jpg",
  },
];

/** Fills its positioned parent. The caption chip is near-solid so it reads over any part of the photo. */
export function SamplePhoto({ index, alt, caption, priority }: { index: number; alt: string; caption: string; priority?: boolean }) {
  const photo = PHOTOS[index % PHOTOS.length];
  return (
    <figure className="absolute inset-0 m-0">
      <Image src={photo.src} alt={alt} fill sizes="(min-width: 1280px) 1216px, 100vw" priority={priority} className="object-cover" style={{ objectPosition: photo.position }} />
      <figcaption className="on-dark absolute top-3 left-3 max-w-[calc(100%-1.5rem)] rounded-2xl bg-ink/80 px-3 py-1.5 text-sm text-white sm:max-w-md">
        {caption}{" "}
        <a href={photo.url} lang="en" className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">
          Photo: {photo.credit}
        </a>
      </figcaption>
    </figure>
  );
}
