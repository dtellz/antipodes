#ANTIPODES

An spherical trigonometry experiment where a ball in the center of the sphere is the core of the game, you dig to find it and take it to the antipodes! (If they let you >.<)

##Technical Specification: Radial-Geodesic Voxel Engine (RGVE)

###1. Project VISION:

To create a voxel-based world that is topologically spherical rather than Cartesian. Players can walk on a planetary surface, dig through concentric layers toward the center (the core), or tunnel outward into space. The engine must avoid "polar singularities" by using an Icosahedral Geodesic Grid for surface coordinates and a Radial Index for depth

###2. Mathematical FOUNDATION:

####2.1 Coordinates system

Instead of (x,y,z), every voxel is defined by two values:

- r (Radial Layer): An integer representing the "shell" index.   r = 0 r=0 is the center point;  r = 10 r=10 is ten layers out from the center.
- cellID (Surface Index): A unique identifier for a specific triangular/hexagonal area on the surface of that shell.

####2.2 Avoiding THE SINGULARITY:

We will not use Latitude/Longitude. Instead, we will use an Icosahedron-based Geodesic Grid.

- The world is divided into 20 primary large triangles (an Icosahedron).
- Each triangle is subdivided into N smaller sub-triangles.
- This ensures that every "voxel" on any layer has roughly the same surface area and volume, regardless of whether it is at the "equator" or a "pole."

####2.3 Voxel Geometry

A single voxel is not a cube; it is a Frustum-shaped Prism (a pyramid with the top cut off).

- The "base" is the triangle on shell r.
- The "top" is the triangle on shell r+1.
- This allows for perfect "stacking" from the center outwards.

###3 DATA Architecture:

####3.1 The Sparse Shell Map (Storage)
Since a spherical world contains massive amounts of empty space, we will use a Hash Map (Dictionary) to store only non-empty voxels.

- Key: (r, cellID)
- Value: VoxelData (Material type, light level, health/hardness)

####3.2 The Hierarchy(level of detail)

To handle scale, we use a Geodesic Octree. When a player is far away, multiple small triangles are treated as one large triangle in the rendering buffer.


